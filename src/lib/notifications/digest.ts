// 日次メールダイジェストの組み立て（純粋ロジック・送信やDBに依存しない）。
// cron(notification-digest) が「直近分の in_app 通知」と「本人の受信設定」を渡し、
// 送るべき中身（種類別セクション）を得る。方針=即時送信は作らず1日1通のまとめのみ。

export type EmailCategory =
  | 'task_assigned'
  | 'task_mentioned'
  | 'review_request'
  | 'client_response'
  | 'meeting_reminder'

export interface NotificationEmailPrefs {
  email_enabled: boolean
  on_task_assigned: boolean
  on_task_mentioned: boolean
  on_review_request: boolean
  on_client_response: boolean
  on_meeting_reminder: boolean
  digest_frequency: 'none' | 'daily' | 'weekly'
}

/**
 * 設定を一度も触っていない人に適用する既定値（＝設定画面が表示している状態）。
 * 設定画面は行が無くても「オン・毎日」と表示するので、配信側もそう扱わないと
 * 「オンに見えるのに届かない」というズレになる（実際に本番で起きた）。
 * 画面側の既定は useNotificationEmailPrefs.DEFAULT_EMAIL_PREFS。両者が一致することは
 * digest.test.ts で検査する。
 */
export const DEFAULT_NOTIFICATION_EMAIL_PREFS: NotificationEmailPrefs = {
  email_enabled: true,
  on_task_assigned: true,
  on_task_mentioned: true,
  on_review_request: true,
  on_client_response: true,
  on_meeting_reminder: true,
  digest_frequency: 'daily',
}

/** ダイジェスト集計に必要な通知行の部分形 */
export interface DigestNotification {
  type: string
  payload: Record<string, unknown> | null
  space_name?: string | null
  created_at: string
}

// notifications.type → メール5カテゴリ の対応。未知の型は含めない（null）。
const TYPE_TO_CATEGORY: Record<string, EmailCategory> = {
  // 割り当て / ボール移動
  task_assigned: 'task_assigned',
  ball_passed: 'task_assigned',
  task_completed: 'task_assigned',
  due_date_reminder: 'task_assigned',
  // メンション / コメント
  mention: 'task_mentioned',
  comment_added: 'task_mentioned',
  comment: 'task_mentioned',
  // 承認・レビュー待ち
  review_request: 'review_request',
  review_cancelled: 'review_request',
  confirmation_request: 'review_request',
  urgent_confirmation: 'review_request',
  spec_decision_needed: 'review_request',
  digest_approval_request: 'review_request',
  // クライアントからの応答
  client_response: 'client_response',
  client_replied: 'client_response',
  client_question: 'client_response',
  client_feedback: 'client_response',
  file_uploaded: 'client_response',
  // 招待の承諾
  invite_accepted: 'client_response',
  // 会議
  meeting_scheduled: 'meeting_reminder',
  meeting_ended: 'meeting_reminder',
  meeting_reminder: 'meeting_reminder',
  scheduling_reminder: 'meeting_reminder',
  scheduling_proposal_expired: 'meeting_reminder',
}

export function categorizeNotificationType(type: string): EmailCategory | null {
  return TYPE_TO_CATEGORY[type] ?? null
}

const CATEGORY_PREF_KEY: Record<EmailCategory, keyof NotificationEmailPrefs> = {
  task_assigned: 'on_task_assigned',
  task_mentioned: 'on_task_mentioned',
  review_request: 'on_review_request',
  client_response: 'on_client_response',
  meeting_reminder: 'on_meeting_reminder',
}

// 見出しは「種類のグループ名」。1つの見出しに複数の通知タイプが入るので、
// 特定のタイプを指す言い方（例:「あなたにボールが回ってきたタスク」）にすると
// 完了・期限のお知らせが入ったときに嘘になる。広い言い方にしておく。
export const CATEGORY_LABEL: Record<EmailCategory, string> = {
  task_assigned: 'タスクの動き',
  task_mentioned: 'メンション・コメント',
  review_request: '承認・レビュー',
  client_response: '相手先からの連絡',
  meeting_reminder: '会議・日程調整',
}

const CATEGORY_ORDER: EmailCategory[] = [
  'task_assigned',
  'task_mentioned',
  'review_request',
  'client_response',
  'meeting_reminder',
]

export interface DigestItem {
  title: string
  spaceName: string | null
}
export interface DigestSection {
  category: EmailCategory
  label: string
  items: DigestItem[]
}

/** ダイジェスト末尾に足す「未承諾の招待」節の1件ぶん */
export interface PendingInviteItem {
  email: string
  spaceName: string | null
}

/** 「未承諾の招待」節のまとめ。件数(count)は先頭プレビュー(items)より多いことがある */
export interface PendingInvitesSummary {
  count: number
  items: PendingInviteItem[]
}

/** 「未承諾の招待」節に載せるプレビュー件数の上限 */
export const PENDING_INVITES_PREVIEW_LIMIT = 5

export interface Digest {
  sections: DigestSection[]
  totalCount: number
  /**
   * 未承諾の招待（作成から3日以上）のまとめ。buildDigest は DB を見ないので
   * ここでは設定しない — 呼び出し元(cron)が invites を取得して後付けする。
   * 0件なら未設定のまま（この節だけでメールを送ることはない）。
   */
  pendingInvites?: PendingInvitesSummary
}

function itemTitle(n: DigestNotification): string {
  const p = n.payload ?? {}
  const pick = (k: string) => (typeof p[k] === 'string' && (p[k] as string).length > 0 ? (p[k] as string) : null)
  return pick('title') || pick('task_title') || pick('meeting_title') || pick('message') || '(タイトルなし)'
}

/**
 * prefs で有効な種類のみを対象に、通知をカテゴリ別へ集約する。
 * email_enabled=false / digest_frequency='none' / 対象0件 の場合は null（=送らない）。
 */
export function buildDigest(
  notifications: DigestNotification[],
  prefs: NotificationEmailPrefs,
): Digest | null {
  if (!prefs.email_enabled || prefs.digest_frequency === 'none') return null

  const byCategory = new Map<EmailCategory, DigestItem[]>()
  for (const notification of notifications) {
    const category = categorizeNotificationType(notification.type)
    if (!category) continue
    if (!prefs[CATEGORY_PREF_KEY[category]]) continue
    const list = byCategory.get(category) ?? []
    list.push({ title: itemTitle(notification), spaceName: notification.space_name ?? null })
    byCategory.set(category, list)
  }

  const sections: DigestSection[] = []
  let totalCount = 0
  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category)
    if (items && items.length > 0) {
      sections.push({ category, label: CATEGORY_LABEL[category], items })
      totalCount += items.length
    }
  }

  if (totalCount === 0) return null
  return { sections, totalCount }
}
