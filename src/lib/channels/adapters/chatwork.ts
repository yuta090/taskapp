import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'

/**
 * Chatwork 送信アダプタ（POST /v2/rooms/{room_id}/messages）。
 * 認証は X-ChatWorkToken ヘッダ。body は application/x-www-form-urlencoded の `body=`。
 * room_id はURLパスに埋め込むため数値のみ許容し、それ以外は恒久失敗にする。
 */
const API_BASE = 'https://api.chatwork.com/v2'
const ROOM_ID_RE = /^\d+$/

export const chatworkAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const token = ctx.credentials.api_token
  if (!token) return missingCredential('api_token')
  if (!ROOM_ID_RE.test(ctx.to)) {
    return { ok: false, permanent: true, error: `invalid chatwork room_id: ${ctx.to}` }
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}/rooms/${ctx.to}/messages`, {
      method: 'POST',
      headers: {
        'X-ChatWorkToken': token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ body: ctx.text }).toString(),
    })
  } catch (e) {
    return { ok: false, permanent: false, error: `network error: ${(e as Error).message}` }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, ...classifyStatus(res.status), error: `chatwork http ${res.status}` }
  }

  const body = (await res.json().catch(() => null)) as { message_id?: string } | null
  return { ok: true, status: res.status, externalMessageId: body?.message_id }
}
