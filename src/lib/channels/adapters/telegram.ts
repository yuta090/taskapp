import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'

/**
 * Telegram 送信アダプタ（Bot API sendMessage）。
 * Bot token はURLパスに含むため、フォーマット（<digits>:<alnum-_->）を軽く検証する。
 * Telegram も論理エラーで body.ok=false（HTTPは4xxのことが多いが200もあり得る）。
 */
const TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/

export const telegramAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const token = ctx.credentials.bot_token
  if (!token) return missingCredential('bot_token')
  if (!TOKEN_RE.test(token)) {
    return { ok: false, permanent: true, error: 'invalid telegram bot_token format' }
  }

  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ctx.to, text: ctx.text }),
    })
  } catch (e) {
    return { ok: false, permanent: false, error: `network error: ${(e as Error).message}` }
  }

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; description?: string; result?: { message_id?: number } }
    | null

  if (!res.ok || !body || body.ok !== true) {
    const cls = classifyStatus(res.status)
    return {
      ok: false,
      status: res.status,
      permanent: cls.permanent,
      error: `telegram: ${body?.description ?? `http ${res.status}`}`,
    }
  }

  return { ok: true, status: res.status, externalMessageId: body.result?.message_id?.toString() }
}
