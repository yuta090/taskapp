import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'
import { pushLineMessage, LinePushError } from '@/lib/channels/line/client'

/**
 * LINE 送信アダプタ。既存の push クライアントを統一インターフェースに橋渡しする。
 * 送信通数を消費するため、既存の digest 経路（reply優先）とは用途が異なる汎用push用。
 */
export const lineAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const accessToken = ctx.credentials.access_token
  if (!accessToken) return missingCredential('access_token')

  try {
    await pushLineMessage({
      accessToken,
      to: ctx.to,
      messages: [{ type: 'text', text: ctx.text }],
      retryKey: ctx.idempotencyKey,
    })
    return { ok: true, status: 200 }
  } catch (e) {
    if (e instanceof LinePushError) {
      return { ok: false, status: e.status, ...classifyStatus(e.status), error: e.message }
    }
    return { ok: false, permanent: false, error: `line network error: ${(e as Error).message}` }
  }
}
