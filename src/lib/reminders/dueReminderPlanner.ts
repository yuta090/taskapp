/**
 * 期限リマインド planner の純粋ロジック（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md
 * §6/§6.1/§13・PR-1）。
 *
 * DB/時刻の副作用を持たない。cron route（またはDBアクセス層）が集めたタスク候補と
 * 現在時刻を渡すだけで「今回 materialize すべき occurrence draft」を返す。
 * 実際の insert（on conflict do nothing）は dueReminderStore.ts が担う。
 *
 * オフセット群・送信時刻・grace は全て §13（open items・数値のみ実装時確定）の確定値:
 *   - オフセット: [0, +1440] 分（当日 / 超過1回。うざくない秘書 再設計・Fable+Codex一致裁定で
 *     「1日前」の事前リマインドは既定オフから撤去。反復は同意ベースにする方針のため）
 *   - 送信時刻: 9:00 JST（SEND_HOUR_JST）
 *   - grace: scheduled_at < now - 24h の occurrence は生成しない（ロールアウト時の一斉送信防止）
 */

/** テンプレラベル（本文の出し分け用）。offset_minutes と独立（§4.2）。 */
export type DueReminderKind = 'due_soon' | 'due_today' | 'overdue_confirm'

/**
 * 既定オフセット群（分）。負=期限前・0=当日・正=超過。PR-2で org/project/task 設定に置き換わる（§8）。
 *
 * うざくない秘書 再設計（Fable+Codex一致裁定）: 既定は「当日＋超過1回」のみにし、
 * 「1日前」の事前リマインド(-1440)は既定オフセットから外した。offsetToKind は引き続き
 * 負値を due_soon として解釈できる（将来のタスク単位の上書き設定でユーザーが「1日前」を
 * 個別に有効化できるようにするための後方互換・§8）。
 */
export const DUE_REMINDER_OFFSETS_MINUTES = [0, 1440] as const

/** 送信時刻（JST・§13仮値）。offset_minutes とは分離し、日付成分にのみ時刻を焼き込む。 */
export const SEND_HOUR_JST = 9

/** materialize grace（§13仮値）。ロールアウト時に過去期限を一斉送信しないための下限。 */
export const MATERIALIZE_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * offset_minutes からテンプレkindを決める。負=due_soon・0=due_today・正=overdue_confirm。
 * 固定3値([-1440,0,1440])に限らず、任意の日単位オフセットに対して汎用的に成立する
 * （PR-2のタスク単位上書きが将来別のオフセット値を持ち込んでも壊れない）。
 */
export function offsetToKind(offsetMinutes: number): DueReminderKind {
  if (offsetMinutes < 0) return 'due_soon'
  if (offsetMinutes === 0) return 'due_today'
  return 'overdue_confirm'
}

/**
 * due_date（JSTカレンダー日・'YYYY-MM-DD'）と offset_minutes から scheduled_at（絶対時刻ISO）を計算する。
 *
 * scheduled_at = jstMidnight(due_date + offsetDays) + SEND_HOUR_JST。
 * JST=UTC+9（夏時間なし）なので「due_date+offsetDays 日の JST SEND_HOUR_JST:00」は
 * 「同じカレンダー日の UTC (SEND_HOUR_JST-9):00」に一致する。Date.UTC は日/時のオーバーフロー・
 * 繰り下がりを自動正規化するため、offsetDays をそのまま日フィールドへ加算してよい
 * （ホストのローカルタイムゾーンに依存しない・toISOString()は絶対時刻の直列化のみに使う）。
 */
export function computeScheduledAtIso(dueDate: string, offsetMinutes: number): string {
  const offsetDays = offsetMinutes / (24 * 60)
  if (!Number.isInteger(offsetDays)) {
    throw new Error(`offsetMinutes must be a multiple of 1440 (1 day): ${offsetMinutes}`)
  }
  const [year, month, day] = dueDate.split('-').map(Number)
  if (!year || !month || !day) {
    throw new Error(`invalid dueDate (expected YYYY-MM-DD): ${dueDate}`)
  }
  const utcMs = Date.UTC(year, month - 1, day + offsetDays, SEND_HOUR_JST - 9, 0, 0, 0)
  return new Date(utcMs).toISOString()
}

/** planner の対象抽出条件（§3）を判定する入力の最小形。 */
export interface DueReminderEligibilityInput {
  dueDate: string | null
  status: string
  assigneeId: string | null
}

/**
 * occurrence生成の対象条件（§3）: due_date IS NOT NULL AND status<>'done' AND assignee_id IS NOT NULL。
 * DBクエリ側（dueReminderStore.findDueReminderCandidateTasks）でも同等の絞り込みを行うが、
 * 純関数側でも判定できるようにする（defense-in-depth。テストで「候補に混ざっても生成されない」を保証）。
 */
export function isDueReminderEligible(
  task: DueReminderEligibilityInput,
): task is DueReminderEligibilityInput & { dueDate: string } {
  return task.dueDate !== null && task.status !== 'done' && task.assigneeId !== null
}

export interface DueReminderCandidateTask {
  id: string
  dueDate: string // YYYY-MM-DD
}

export interface DueReminderOccurrenceDraft {
  taskId: string
  kind: DueReminderKind
  offsetMinutes: number
  dueSnapshot: string
  scheduledAt: string
}

/**
 * 1タスク分の occurrence draft を offsets 全てについて作る。grace（scheduled_at < now-24h）を
 * 満たさない draft は生成しない（過去期限の一斉送信防止・§13）。
 */
export function buildDueReminderOccurrenceDrafts(
  task: DueReminderCandidateTask,
  now: Date,
  offsets: readonly number[] = DUE_REMINDER_OFFSETS_MINUTES,
): DueReminderOccurrenceDraft[] {
  const graceThresholdMs = now.getTime() - MATERIALIZE_GRACE_MS
  return offsets
    .map((offsetMinutes) => ({
      taskId: task.id,
      kind: offsetToKind(offsetMinutes),
      offsetMinutes,
      dueSnapshot: task.dueDate,
      scheduledAt: computeScheduledAtIso(task.dueDate, offsetMinutes),
    }))
    .filter((draft) => new Date(draft.scheduledAt).getTime() >= graceThresholdMs)
}

/**
 * 複数タスク（未フィルタの候補を含んでよい）から occurrence draft をまとめて作る。
 * isDueReminderEligible で対象外（assignee無・done・due無）を落としてから展開する。
 */
export function buildDueReminderOccurrenceDraftsForTasks(
  tasks: Array<DueReminderEligibilityInput & { id: string }>,
  now: Date,
  offsets: readonly number[] = DUE_REMINDER_OFFSETS_MINUTES,
): DueReminderOccurrenceDraft[] {
  return tasks.flatMap((task) => {
    if (!isDueReminderEligible(task)) return []
    return buildDueReminderOccurrenceDrafts({ id: task.id, dueDate: task.dueDate }, now, offsets)
  })
}
