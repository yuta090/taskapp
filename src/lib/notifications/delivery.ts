/**
 * 通知を「その場で届けるか / 1日1回のまとめに回すか / 送らないか」の正本（純関数）。
 *
 * 判断の軸はひとつだけ: **受け取る人が動かないと、誰かが待って止まるか**。
 *   - 止まる  → その場で届ける（プッシュ＋メール）
 *   - 止まらないが知りたい → プッシュだけその場・メールはまとめ
 *   - 知らせるだけ → まとめのみ
 *
 * ここを1か所にしておく理由: プッシュ配信(api/push/dispatch)・まとめメール(cron/notification-digest)・
 * 今後の即時メールが、それぞれ勝手な条件を持つと「同じ用件が二度鳴る」「片方だけ静かな時間を無視する」
 * といったズレが必ず出る。種類を足すときはこのファイルに1行足す（漏れは delivery.test.ts が検出する）。
 */

/** プッシュは「その場で鳴らす」か「鳴らさない」かの2択（プッシュにまとめは無い） */
export type PushTier = 'immediate' | 'none'
/** メールは即時・1日1回のまとめ・送らない（専用メールが別にある種類は 'none'） */
export type EmailTier = 'immediate' | 'digest' | 'none'

export interface DeliveryPolicy {
  push: PushTier
  email: EmailTier
}

const IMMEDIATE: DeliveryPolicy = { push: 'immediate', email: 'immediate' }
const PUSH_ONLY: DeliveryPolicy = { push: 'immediate', email: 'digest' }
const DIGEST_ONLY: DeliveryPolicy = { push: 'none', email: 'digest' }
const SILENT: DeliveryPolicy = { push: 'none', email: 'none' }

const POLICY: Readonly<Record<string, DeliveryPolicy>> = {
  // ── 相手が待って止まっている: その場で届ける ──
  review_request: IMMEDIATE,
  spec_decision_needed: IMMEDIATE,
  confirmation_request: IMMEDIATE,
  urgent_confirmation: IMMEDIATE,
  ball_passed: IMMEDIATE,
  client_question: IMMEDIATE,
  client_feedback: IMMEDIATE,
  client_response: IMMEDIATE,
  client_replied: IMMEDIATE,
  // 連携が止まっている＝気づくのが遅れるほど取りこぼしが増えるので即時
  sink_error: IMMEDIATE,

  // ── 知りたいが今すぐ動く必要はない: 鳴らすがメールはまとめ ──
  task_assigned: PUSH_ONLY,
  due_date_reminder: PUSH_ONLY,
  meeting_reminder: PUSH_ONLY,
  mention: PUSH_ONLY,
  comment_added: PUSH_ONLY,
  comment: PUSH_ONLY,

  // ── 知らせるだけ: まとめのみ ──
  task_completed: DIGEST_ONLY,
  file_uploaded: DIGEST_ONLY,
  invite_accepted: DIGEST_ONLY,
  meeting_scheduled: DIGEST_ONLY,
  meeting_ended: DIGEST_ONLY,
  scheduling_reminder: DIGEST_ONLY,
  scheduling_proposal_expired: DIGEST_ONLY,
  review_cancelled: DIGEST_ONLY,
  // AI秘書が拾ったタスク候補の承認。もともと1日1回まとまって届くものなので鳴らさない
  digest_approval_request: DIGEST_ONLY,

  // ── 専用のメールが別にある: まとめに入れると二重になる ──
  pool_ai_exhausted: SILENT,
  free_cap_upgrade: SILENT,
  group_claim_linked: SILENT,
  sink_disabled_relink: SILENT,
}

/** ポリシーを定義済みの種類。テストが labels.ts との突き合わせに使う */
export const ALL_NOTIFICATION_TYPES: readonly string[] = Object.keys(POLICY)

/** 鳴らす種類。1日の本数を数えるときの絞り込みに使う */
export const PUSH_IMMEDIATE_TYPES: readonly string[] = ALL_NOTIFICATION_TYPES.filter(
  (type) => POLICY[type].push === 'immediate',
)

/** その場でメールを送る種類。5分ごとの即時配信ワーカーが対象を絞るのに使う */
export const EMAIL_IMMEDIATE_TYPES: readonly string[] = ALL_NOTIFICATION_TYPES.filter(
  (type) => POLICY[type].email === 'immediate',
)

/** 知らない種類は鳴らさない・送らない。増やした人が意図して1行足すまで静かにしておく */
export function getDeliveryPolicy(type: string): DeliveryPolicy {
  return POLICY[type] ?? SILENT
}

/**
 * 静かな時間帯（JST）。夜21時〜翌朝8時と、土日は終日。
 * 引数は jstNow() が返す「ローカル getter が JST を返す Date」であること。
 */
export const QUIET_HOURS_START = 21
export const QUIET_HOURS_END = 8

export function isQuietHours(jstDate: Date): boolean {
  const day = jstDate.getDay() // 0=日, 6=土
  if (day === 0 || day === 6) return true
  const hour = jstDate.getHours()
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END
}

/**
 * 静かな時間帯も1日の上限も無視して鳴らす種類。
 * 「至急」と名乗っているものだけ。ここを増やすと歯止めが意味を失うので慎重に。
 */
export const QUIET_HOURS_EXEMPT_TYPES: readonly string[] = ['urgent_confirmation']

/**
 * 1人1日あたりに鳴らす上限。超えたぶんは受信箱と翌朝のまとめに残るので消えはしない。
 * 会議のあとに大量発生した日でも、端末が鳴り続けないための歯止め。
 */
export const PUSH_DAILY_CAP = 10

/** 鳴らさなかった理由。ログと応答に出して、静かな原因を追えるようにする */
export type PushSkipReason = 'policy' | 'quiet_hours' | 'daily_cap'

export interface PushDecisionInput {
  type: string
  /** jstNow() の返り値（JST成分の Date） */
  jstDate: Date
}

export interface ShouldSendPushInput extends PushDecisionInput {
  /** 同じ日に既に鳴らした件数 */
  immediateCountToday: number
}

/**
 * 件数を数える前に分かる理由だけを判定する。
 * 「そもそも鳴らさない種類」「静かな時間帯」で弾ければ、件数を数えるクエリを省ける。
 */
export function pushSkipReasonWithoutCount({ type, jstDate }: PushDecisionInput): PushSkipReason | null {
  if (getDeliveryPolicy(type).push !== 'immediate') return 'policy'
  if (QUIET_HOURS_EXEMPT_TYPES.includes(type)) return null
  if (isQuietHours(jstDate)) return 'quiet_hours'
  return null
}

/** 1日の上限も含めた最終判定 */
export function pushSkipReason({
  type,
  jstDate,
  immediateCountToday,
}: ShouldSendPushInput): PushSkipReason | null {
  const early = pushSkipReasonWithoutCount({ type, jstDate })
  if (early) return early
  if (QUIET_HOURS_EXEMPT_TYPES.includes(type)) return null
  if (immediateCountToday >= PUSH_DAILY_CAP) return 'daily_cap'
  return null
}

export function shouldSendPush(input: ShouldSendPushInput): boolean {
  return pushSkipReason(input) === null
}
