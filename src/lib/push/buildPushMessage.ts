import { buildTaskDeepLink } from '@/lib/taskLinks'
import { isSafeInternalPath } from '@/lib/auth/safeRedirect'

export interface PushNotificationRow {
  id: string
  org_id: string
  space_id: string
  type: string
  payload: {
    message?: string
    task_id?: string
    link?: string
    uploader_name?: string
    file_name?: string
    /** review_approved が持つ、承認の進み具合込みの見出し（誰が承認した／全員そろった）。 */
    title?: string
  }
}

// Types whose payload carries an explicit `link` (no task_id) — the deep link
// must come from the payload rather than the task_id-based fallback below.
const LINK_PAYLOAD_TYPES: ReadonlySet<string> = new Set([
  'scheduling_reminder',
  'scheduling_proposal_expired',
  'file_uploaded',
  'invite_accepted',
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
  review_approved: '社内承認が承認されました',
  confirmation_request: '確認依頼が届きました',
  urgent_confirmation: '至急の確認依頼があります',
  task_assigned: 'タスクが割り当てられました',
  spec_decision_needed: '仕様の決定が必要です',
  invite_accepted: '招待が承諾されました',
  client_approved: '相手先が承認しました',
  github_pr_merged: 'タスクの変更が取り込まれました',
  comment_added: 'タスクにコメントが付きました',
  mention: 'コメントであなたが呼ばれました',
}

const DEFAULT_TITLE = '新しい通知があります'

export function buildPushMessage(n: PushNotificationRow, role: PushRecipientRole): PushMessage {
  // file_uploaded has no fixed title — it needs the uploader/file name baked
  // in, since a push notification must stand on its own outside the app.
  //
  // review_approved も固定文言だけでは足りない: 承認者が複数いるとき、1人目の
  // 承認だけでも見出しが「社内承認が承認されました」になり、タスク名も無く
  // まだ全員そろっていないのに揃った印象を与えていた（見出ししか読まない人が
  // 誤って先へ進めかねない）。payload.title に「誰が承認した／全員そろった」
  // ＋タスク名込みの文面が積まれているので、あればそちらを見出しに使う。
  const title = n.type === 'file_uploaded'
    ? `${n.payload.uploader_name ?? 'クライアント'}さんが資料をアップロードしました: ${n.payload.file_name ?? 'ファイル'}`
    : n.type === 'review_approved' && n.payload.title
      ? n.payload.title
      : TITLE_BY_TYPE[n.type] ?? DEFAULT_TITLE
  const body = n.payload.message ?? ''
  const taskId = n.payload.task_id

  const safeLink =
    LINK_PAYLOAD_TYPES.has(n.type) && isSafeInternalPath(n.payload.link) ? n.payload.link : null

  const url =
    safeLink ??
    (role === 'client'
      ? taskId
        ? `/portal/task/${taskId}`
        : '/portal'
      : taskId
        ? buildTaskDeepLink(n.org_id, n.space_id, taskId)
        : '/inbox')

  return { title, body, url, tag: `taskapp-${n.id}` }
}
