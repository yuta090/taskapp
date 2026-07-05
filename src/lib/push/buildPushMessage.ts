import { buildTaskDeepLink } from '@/lib/taskLinks'

export interface PushNotificationRow {
  id: string
  org_id: string
  space_id: string
  type: string
  payload: { message?: string; task_id?: string }
}

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
  const title = TITLE_BY_TYPE[n.type] ?? DEFAULT_TITLE
  const body = n.payload.message ?? ''
  const taskId = n.payload.task_id

  const url =
    role === 'client'
      ? taskId
        ? `/portal/task/${taskId}`
        : '/portal'
      : taskId
        ? buildTaskDeepLink(n.org_id, n.space_id, taskId)
        : '/inbox'

  return { title, body, url, tag: `taskapp-${n.id}` }
}
