import { isSafeInternalPath } from '@/lib/auth/safeRedirect'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import { buildMeetingHref } from '@/lib/navigation/meetingLinks'

/**
 * 受信トレイから元の内容（タスク・会議）を開くリンク。
 * 承認依頼・コメント・メンションなど、通知の大半は payload.link を持たない（2026-10-28 に本番で確認）。
 * そのときは task_id / meeting_id と通知の org_id・space_id から組み立てる。開けるものが無ければ null。
 */
export function notificationOpenLink(notification: {
  org_id: string
  space_id: string
  payload: { link?: unknown; task_id?: unknown; meeting_id?: unknown }
}): string | null {
  const { org_id: orgId, space_id: spaceId, payload } = notification
  if (typeof payload.link === 'string' && isSafeInternalPath(payload.link)) return payload.link
  if (typeof payload.task_id === 'string' && payload.task_id) {
    return buildTaskDeepLink(orgId, spaceId, payload.task_id)
  }
  if (typeof payload.meeting_id === 'string' && payload.meeting_id) {
    return buildMeetingHref(`/${orgId}/project/${spaceId}`, payload.meeting_id)
  }
  return null
}
