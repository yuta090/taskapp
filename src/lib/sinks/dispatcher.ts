import {
  claimSinkDeliveries,
  completeSinkDelivery,
  findDeliverableSinksByIds,
  type ClaimedDelivery,
  type DeliverableSink,
  type DeliveryOutcome,
} from '@/lib/sinks/store'
import { deliverWebhook } from '@/lib/sinks/adapters/webhook'
import { deliverNotion } from '@/lib/sinks/adapters/notion'
import { deliverGoogleSheets } from '@/lib/sinks/adapters/google_sheets'
import { classifyDeliveryFailure } from '@/lib/sinks/backoff'
import { notifySinkBecameError } from '@/lib/sinks/notify'

/**
 * 配送ワーカーの本体（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-2）。
 * claim(リース取得) -> deliver(webhookアダプタ) -> classify(恒久/一時) -> complete(確定) の
 * オーケストレーション。POST /api/cron/sink-dispatch と、test送信・redeliver後の
 * ベストエフォート即時実行の両方から呼ばれる。
 */

export interface DispatchSummary {
  claimed: number
  sent: number
  failed: number
  dead: number
  errors: string[]
}

type DeliveryOutcomeResult = 'sent' | 'failed' | 'dead'

export async function dispatchClaimedDelivery(
  delivery: ClaimedDelivery,
  sink: DeliverableSink,
): Promise<DeliveryOutcomeResult> {
  const result =
    sink.provider === 'notion'
      ? await deliverNotion(sink, {
          id: delivery.id,
          digestTaskId: delivery.digestTaskId,
          eventType: delivery.eventType,
          eventKey: delivery.eventKey,
          payload: delivery.payload,
        })
      : sink.provider === 'google_sheets'
        ? await deliverGoogleSheets(sink, {
            id: delivery.id,
            eventType: delivery.eventType,
            eventKey: delivery.eventKey,
            payload: delivery.payload,
          })
        : await deliverWebhook(sink, {
            id: delivery.id,
            eventType: delivery.eventType,
            eventKey: delivery.eventKey,
            payload: delivery.payload,
          })

  if (result.ok) {
    await completeSinkDelivery({
      deliveryId: delivery.id,
      outcome: 'sent',
      responseStatus: result.responseStatus,
      countsTowardFailures: false,
    })
    return 'sent'
  }

  // アダプタが明示的にpermanentと判定した場合(SSRF拒否・リダイレクト未追跡)はそれに従い、
  // それ以外はレスポンスstatus(またはネットワークエラー)から分類する。
  const classification =
    result.permanent === true
      ? { outcome: 'permanent' as const, countsTowardFailures: true }
      : classifyDeliveryFailure(result.responseStatus, result.responseStatus === undefined)

  const outcome: DeliveryOutcome =
    classification.outcome === 'permanent' ? 'permanent_fail' : 'temporary_fail'

  const completion = await completeSinkDelivery({
    deliveryId: delivery.id,
    outcome,
    responseStatus: result.responseStatus,
    error: result.error,
    countsTowardFailures: classification.countsTowardFailures,
  })

  if (completion.justBecameError) {
    // ベストエフォート: 通知失敗はdispatch自体を失敗させない
    await notifySinkBecameError(delivery.sinkId, delivery.orgId).catch((error) => {
      console.error('dispatchClaimedDelivery: notifySinkBecameError failed', error)
    })
  }

  return completion.deliveryStatus === 'dead' ? 'dead' : 'failed'
}

export interface DispatchBatchOptions {
  totalLimit?: number
  perSinkLimit?: number
}

export async function dispatchBatch(options: DispatchBatchOptions = {}): Promise<DispatchSummary> {
  const claimed = await claimSinkDeliveries(options.totalLimit ?? 100, options.perSinkLimit ?? 10)

  const summary: DispatchSummary = { claimed: claimed.length, sent: 0, failed: 0, dead: 0, errors: [] }
  if (claimed.length === 0) return summary

  const { sinks, transientSinkIds } = await findDeliverableSinksByIds(claimed.map((d) => d.sinkId))

  for (const delivery of claimed) {
    const sink = sinks.get(delivery.sinkId)

    try {
      if (!sink) {
        // レビュー回帰対応(修正2): Google Sheetsのtoken refreshが5xx/ネットワーク等の一時障害で
        // 失敗した場合はsink_not_deliverable(恒久)にせずtemporary_fail(再試行)に落とす。
        // それ以外(未対応provider・secret復号失敗・接続なし・失効)は従来通り恒久失敗。
        const isTransient = transientSinkIds.has(delivery.sinkId)
        const completion = await completeSinkDelivery({
          deliveryId: delivery.id,
          outcome: isTransient ? 'temporary_fail' : 'permanent_fail',
          error: isTransient ? 'sink_connection_transient_error' : 'sink_not_deliverable',
          countsTowardFailures: isTransient,
        })
        if (completion.deliveryStatus === 'dead') summary.dead += 1
        else summary.failed += 1
        continue
      }

      const outcome = await dispatchClaimedDelivery(delivery, sink)
      if (outcome === 'sent') summary.sent += 1
      else if (outcome === 'dead') summary.dead += 1
      else summary.failed += 1
    } catch (error) {
      summary.errors.push(`${delivery.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return summary
}
