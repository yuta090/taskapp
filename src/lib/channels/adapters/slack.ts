import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'

/**
 * Slack 送信アダプタ（chat.postMessage）。
 * Slackは論理エラーでもHTTP200を返し body.ok=false で示すため、statusだけでなく
 * body.ok と error 文字列で恒久/一時を分類する。
 */
const ENDPOINT = 'https://slack.com/api/chat.postMessage'

// リトライ無意味な設定不備系のSlack error（channel_not_found等）は恒久扱い
const PERMANENT_SLACK_ERRORS = new Set([
  'channel_not_found',
  'not_in_channel',
  'invalid_auth',
  'account_inactive',
  'token_revoked',
  'missing_scope',
  'not_authed',
  'is_archived',
  'restricted_action',
])

export const slackAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const token = ctx.credentials.bot_token
  if (!token) return missingCredential('bot_token')

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: ctx.to, text: ctx.text }),
    })
  } catch (e) {
    return { ok: false, permanent: false, error: `network error: ${(e as Error).message}` }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, ...classifyStatus(res.status), error: `slack http ${res.status}` }
  }

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; ts?: string }
    | null

  if (!body || body.ok !== true) {
    const err = body?.error ?? 'unknown_slack_error'
    return { ok: false, status: 200, permanent: PERMANENT_SLACK_ERRORS.has(err), error: `slack: ${err}` }
  }

  return { ok: true, status: 200, externalMessageId: body.ts }
}
