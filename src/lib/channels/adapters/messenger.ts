import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'

/**
 * Facebook Messenger 送信アダプタ（Meta Send API）。
 * POST /me/messages with { recipient, messaging_type, message }。
 * 認証は WhatsApp アダプタと同様に Authorization: Bearer ヘッダで渡す
 * （access_token を URL クエリに載せない＝ログ/APM へのトークン漏れを避ける）。
 * v1は本文テキストのみ対応（rich/quick reply等は非対応）。
 */
const GRAPH_VERSION = 'v21.0'

export const messengerAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const token = ctx.credentials.page_access_token
  if (!token) return missingCredential('page_access_token')

  let res: Response
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: ctx.to },
        messaging_type: 'RESPONSE',
        message: { text: ctx.text },
      }),
    })
  } catch (e) {
    return { ok: false, permanent: false, error: `network error: ${(e as Error).message}` }
  }

  const body = (await res.json().catch(() => null)) as
    | { recipient_id?: string; message_id?: string; error?: { message?: string } }
    | null

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      ...classifyStatus(res.status),
      error: `messenger: ${body?.error?.message ?? `http ${res.status}`}`,
    }
  }

  return { ok: true, status: res.status, externalMessageId: body?.message_id }
}
