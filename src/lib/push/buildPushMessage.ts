import { buildTaskDeepLink } from '@/lib/taskLinks'

export interface PushNotificationRow {
  id: string
  org_id: string
  space_id: string
  type: string
  payload: { message?: string; task_id?: string; link?: string; uploader_name?: string; file_name?: string }
}

// Types whose payload carries an explicit `link` (no task_id) — the deep link
// must come from the payload rather than the task_id-based fallback below.
const LINK_PAYLOAD_TYPES: ReadonlySet<string> = new Set([
  'scheduling_reminder',
  'scheduling_proposal_expired',
  'file_uploaded',
])

export type PushRecipientRole = 'client' | 'internal'

export interface PushMessage {
  title: string
  body: string
  url: string
  tag: string
}

// Push notification titles are phrased as short action prompts, distinct from
// the category labels used in NotificationInspector (e.g. "ボール移動" there
// vs. "ボールがあなたに渡されました" here) — a push title needs to stand on
// its own outside the app.
const TITLE_BY_TYPE: Record<string, string> = {
  ball_passed: 'ボールがあなたに渡されました',
  review_request: '承認依頼が届きました',
  confirmation_request: '確認依頼が届きました',
  urgent_confirmation: '至急の確認依頼があります',
  task_assigned: 'タスクが割り当てられました',
  spec_decision_needed: '仕様の決定が必要です',
}

const DEFAULT_TITLE = '新しい通知があります'

export function buildPushMessage(n: PushNotificationRow, role: PushRecipientRole): PushMessage {
  // file_uploaded has no fixed title — it needs the uploader/file name baked
  // in, since a push notification must stand on its own outside the app.
  const title = n.type === 'file_uploaded'
    ? `${n.payload.uploader_name ?? 'クライアント'}さんが資料をアップロードしました: ${n.payload.file_name ?? 'ファイル'}`
    : TITLE_BY_TYPE[n.type] ?? DEFAULT_TITLE
  const body = n.payload.message ?? ''
  const taskId = n.payload.task_id

  const url =
    LINK_PAYLOAD_TYPES.has(n.type) && n.payload.link
      ? n.payload.link
      : role === 'client'
        ? taskId
          ? `/portal/task/${taskId}`
          : '/portal'
        : taskId
          ? buildTaskDeepLink(n.org_id, n.space_id, taskId)
          : '/inbox'

  return { title, body, url, tag: `taskapp-${n.id}` }
}
