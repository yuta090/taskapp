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

  const resolution = await findDeliverableSinksByIds(claimed.map((d) => d.sinkId))
  const { sinks } = resolution
  // 旧シェイプ(refreshTransientSinkIds 無し)のモック/呼び出しに耐えるようデフォルトを与える。
  const transientSinkIds = resolution.transientSinkIds ?? new Set<string>()
  const refreshTransientSinkIds = resolution.refreshTransientSinkIds ?? new Set<string>()

  for (const delivery of claimed) {
    const sink = sinks.get(delivery.sinkId)

    try {
      if (!sink) {
        // 解決できなかった配達の3分岐(Fable 裁定 2026-07-23):
        //   - infra 一時障害(sink復号/接続フェッチ/DB read の瞬断) → **defer**: attempt を消費せず
        //     5分後に再試行。配達を試みる前に自分のDB/秘密が読めない障害は予算を食わせない。
        //     consecutive_failures は加算し 20連続で自動停止(circuit breaker)へ収束する(RPC 側)。
        //   - 外部refresh 一時障害(google_sheets の refresh 5xx) → 従来どおり temporary_fail(予算消費)。
        //   - それ以外(未対応provider・恒久破損・接続なし・失効) → 従来どおり permanent_fail(恒久)。
        const isInfraTransient = transientSinkIds.has(delivery.sinkId)
        const isRefreshTransient = refreshTransientSinkIds.has(delivery.sinkId)
        const outcome: 'defer' | 'temporary_fail' | 'permanent_fail' = isInfraTransient
          ? 'defer'
          : isRefreshTransient
            ? 'temporary_fail'
            : 'permanent_fail'
        const error = isInfraTransient
          ? 'sink_infra_transient_error'
          : isRefreshTransient
            ? 'sink_token_refresh_transient_error'
            : 'sink_not_deliverable'
        const completion = await completeSinkDelivery({
          deliveryId: delivery.id,
          outcome,
          error,
          // defer/temporary_fail は circuit breaker のため failures にカウントする。permanent は従来どおり非カウント。
          countsTowardFailures: isInfraTransient || isRefreshTransient,
        })
        // 恒久破損を一時障害扱いにした戦略の自己完結: 連続失敗で sink が今回 error 化したら、
        // dispatchClaimedDelivery と同じ導線で既存の停止通知を発火する(20回リトライ→停止→通知→再接続)。
        if (completion.justBecameError) {
          await notifySinkBecameError(delivery.sinkId, delivery.orgId).catch((error) => {
            console.error('dispatchBatch: notifySinkBecameError failed', error)
          })
        }
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
