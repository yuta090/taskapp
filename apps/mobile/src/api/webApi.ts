/**
 * Web のサーバー API を、ログインのアクセストークン（Bearer）で呼ぶ。
 * 受け付けるのは /api/portal/notify-approval・/api/slack/notify（src/lib/supabase/routeAuth.ts）と、
 * 認証なしの /api/mobile/push-token/unregister だけ。
 */
import { buildWebApiRequest } from '~/lib/webApi'
import { supabase } from './supabase'

export const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://agentpm.app'

export async function postWebApi(path: string, body: unknown, options: { auth: boolean } = { auth: true }) {
  const accessToken = options.auth ? ((await supabase.auth.getSession()).data.session?.access_token ?? null) : null
  if (options.auth && !accessToken) return { ok: false, status: 401 }
  const { url, init } = buildWebApiRequest(WEB_BASE_URL, path, accessToken, body)
  const res = await fetch(url, init)
  return { ok: res.ok, status: res.status }
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
