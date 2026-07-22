import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'
import { pushLineMessage, LinePushError, type LineMessage } from '@/lib/channels/line/client'

/**
 * LINE 送信アダプタ。既存の push クライアントを統一インターフェースに橋渡しする。
 * 送信通数を消費するため、既存の digest 経路（reply優先）とは用途が異なる汎用push用。
 *
 * ctx.rich が配列（LineMessage[]）ならそのまま messages として送る（digestのFlex等・
 * 秘書送信境界 sendSecretaryPush 経由）。無ければ従来どおり ctx.text だけの text メッセージ
 * にする。LINE の送信バイト列はこの分岐だけで、既存呼び出し元の挙動は一切変えない。
 */
export const lineAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const accessToken = ctx.credentials.access_token
  if (!accessToken) return missingCredential('access_token')

  const messages: LineMessage[] = Array.isArray(ctx.rich)
    ? (ctx.rich as LineMessage[])
    : [{ type: 'text', text: ctx.text }]

  try {
    await pushLineMessage({
      accessToken,
      to: ctx.to,
      messages,
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
