import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'

/**
 * WhatsApp Business 送信アダプタ（Meta Cloud API）。
 * POST /{phone_number_id}/messages with Bearer token。
 * 24時間カスタマーサービスウィンドウ外はテンプレート必須だが、v1は本文テキストのみ対応。
 */
const GRAPH_VERSION = 'v21.0'
const PHONE_ID_RE = /^\d+$/

export const whatsappAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const token = ctx.credentials.access_token
  const phoneId = ctx.credentials.phone_number_id
  if (!token) return missingCredential('access_token')
  if (!phoneId) return missingCredential('phone_number_id')
  if (!PHONE_ID_RE.test(phoneId)) {
    return { ok: false, permanent: true, error: `invalid phone_number_id: ${phoneId}` }
  }

  let res: Response
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: ctx.to,
        type: 'text',
        text: { body: ctx.text },
      }),
    })
  } catch (e) {
    return { ok: false, permanent: false, error: `network error: ${(e as Error).message}` }
  }

  const body = (await res.json().catch(() => null)) as
    | { messages?: Array<{ id?: string }>; error?: { message?: string } }
    | null

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      ...classifyStatus(res.status),
      error: `whatsapp: ${body?.error?.message ?? `http ${res.status}`}`,
    }
  }

  return { ok: true, status: res.status, externalMessageId: body?.messages?.[0]?.id }
}
