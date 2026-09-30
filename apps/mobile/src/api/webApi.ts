/**
 * Web のサーバー API を、ログインのアクセストークン（Bearer）で呼ぶ。
 * 受け付けるのは /api/portal/notify-approval・/api/slack/notify（src/lib/supabase/routeAuth.ts）と、
 * 認証なしの /api/mobile/push-token/unregister だけ。
 */
import { approvalEmailSent, buildWebApiRequest } from '~/lib/webApi'
import { supabase } from './supabase'

export const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://agentpm.app'

/** 電波の悪い所でボタンが待ち続けないように。切れたら失敗として返す */
const TIMEOUT_MS = 10_000

export async function postWebApi(
  path: string,
  body: unknown,
  options: { auth: boolean } = { auth: true }
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const accessToken = options.auth ? ((await supabase.auth.getSession()).data.session?.access_token ?? null) : null
  if (options.auth && !accessToken) return { ok: false, status: 401, json: null }
  const { url, init } = buildWebApiRequest(WEB_BASE_URL, path, accessToken, body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const json: unknown = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } catch {
    return { ok: false, status: 0, json: null }
  } finally {
    clearTimeout(timer)
  }
}

type SlackEvent = 'ball_passed' | 'status_changed' | 'comment_added'

/** Web の fireNotification（src/lib/slack/notify.ts）と同じ中身で Slack に知らせる。送りっぱなし */
export function notifySlack(params: {
  event: SlackEvent
  taskId: string
  spaceId: string
  changes?: { oldStatus?: string; newStatus?: string; newBall?: string; commentBody?: string }
}): void {
  postWebApi('/api/slack/notify', params).catch((e: unknown) => console.warn('[slack-notify] Failed:', e))
}

/** 承認依頼メール（/api/portal/notify-approval）を送り、実際に送れたかを返す */
export async function sendApprovalEmail(taskId: string): Promise<boolean> {
  try {
    const res = await postWebApi('/api/portal/notify-approval', { taskId })
    return approvalEmailSent(res.ok, res.json)
  } catch {
    return false
  }
}
