import { safeFetch } from '@/lib/sinks/ssrf'
import { buildSignatureHeader } from '@/lib/sinks/signature'

/**
 * 汎用Webhookアダプタ（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3）。
 * 「自社ツール連携」の実体。SSRF検証込みの safeFetch を必ず経由する。
 */

export interface WebhookSink {
  id: string
  provider: 'webhook'
  config: { url: string }
  /** 復号済みの平文secret */
  secret: string
}

export interface DeliverableDelivery {
  id: string
  eventType: string
  eventKey: string
  payload: {
    occurred_at: string
    task: Record<string, unknown>
  }
}

export interface AdapterResult {
  ok: boolean
  /** trueなら恒久失敗（リトライしない）。undefinedならdispatcher側でレスポンスstatusから分類する */
  permanent?: boolean
  responseStatus?: number
  error?: string
}

export async function deliverWebhook(
  sink: WebhookSink,
  delivery: DeliverableDelivery,
): Promise<AdapterResult> {
  const body = JSON.stringify({
    id: delivery.id,
    event: delivery.eventType,
    event_key: delivery.eventKey,
    occurred_at: delivery.payload.occurred_at,
    data: { task: delivery.payload.task },
  })

  const signature = buildSignatureHeader(sink.secret, body)

  const result = await safeFetch(sink.config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AgentPM-Signature': signature,
    },
    body,
  })

  if (!result.ok) {
    // ssrf_blocked（DNS rebinding等で配送時に検証が変化した場合を含む）は
    // 恒久失敗として扱い、攻撃対象を無限リトライしないようにする。
    // それ以外（タイムアウト・接続エラー等）はdispatcher側で一時失敗として再試行させる。
    const isSsrfBlocked = result.error?.startsWith('ssrf_blocked:') ?? false
    return { ok: false, permanent: isSsrfBlocked || undefined, error: result.error }
  }

  if (result.status !== undefined && result.status >= 300 && result.status < 400) {
    // リダイレクトは追わない＝恒久失敗
    return {
      ok: false,
      permanent: true,
      responseStatus: result.status,
      error: `redirect_not_followed:${result.status}`,
    }
  }

  if (result.status !== undefined && result.status >= 200 && result.status < 300) {
    return { ok: true, responseStatus: result.status }
  }

  // 4xx/5xxはdispatcher側(classifyDeliveryFailure)がstatusを見て分類する
  return { ok: false, responseStatus: result.status, error: result.bodyText?.slice(0, 500) }
}
