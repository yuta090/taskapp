import type { Task } from '@/types/database'

/**
 * ダッシュボードの「確定事項」。このプロジェクトで決まったこと（決定事項のタスク）を新しい順に出し、
 * まだ決まっていないもの（検討中）を分けて添える。
 *
 * 確定の単位はページではなく決定1件＝`type='spec'` のタスク（docs/spec/DECISION_RECORD_SPEC.md）。
 * 「決まった」は decided と implemented の両方（実装済みは決まったあとの先の話）。数え方は Wiki 一覧の
 * 「確定 2/5」（src/lib/wiki/decisionCounts.ts）と同じにして、同じものを見ている2つの画面で食い違わないようにする。
 *
 * 「いつ決まったか」はタスクの列には無いので、決めたときの記録（task_events の SPEC_DECIDE /
 * SPEC_IMPLEMENT）から引く。読み込みの範囲より古い決定は日付が出ないが、並びと件数は正しいまま。
 */

/** useSpecDecisionEvents が読む記録の列 */
export interface DecisionEventRow {
  task_id: string
  action: string
  created_at: string
}

/** 「決まった」ときに残る記録の種類 */
export const DECISION_EVENT_ACTIONS = ['SPEC_DECIDE', 'SPEC_IMPLEMENT'] as const

/**
 * 読みに行く記録の件数。決定は数が少ないので、これで足りなくなるのは長く続いたプロジェクトだけ。
 * 足りなくなっても日付が出なくなるだけで、一覧そのものはタスクの側から作る。
 */
export const DECISION_EVENT_FETCH_LIMIT = 200

export interface DecidedItem {
  task: Task
  /** 決まった日時。記録が読み込みの範囲より古いときは null */
  decidedAt: string | null
}

export interface DecisionSummary {
  /** 決まったこと（新しい順） */
  decided: DecidedItem[]
  /** まだ決まっていない決定事項のタスク（新しい順） */
  considering: Task[]
}

/** タスクごとに一番新しい記録の日時を引く。決定のあと実装済みにしたら、あとの日付になる。 */
export function decidedAtByTask(events: readonly DecisionEventRow[]): Map<string, string> {
  const latest = new Map<string, string>()
  for (const ev of events) {
    const current = latest.get(ev.task_id)
    if (current == null || Date.parse(ev.created_at) > Date.parse(current)) {
      latest.set(ev.task_id, ev.created_at)
    }
  }
  return latest
}

function isDecided(task: Task): boolean {
  return task.decision_state === 'decided' || task.decision_state === 'implemented'
}

export function summarizeDecisions(
  tasks: readonly Task[],
  events: readonly DecisionEventRow[]
): DecisionSummary {
  const decidedAt = decidedAtByTask(events)
  const specTasks = tasks.filter((t) => t.type === 'spec')

  const decided = specTasks
    .filter(isDecided)
    .map((task) => ({ task, decidedAt: decidedAt.get(task.id) ?? null }))
    // 記録が無いものは最後に更新した日で代わりに並べる（並び順だけに使い、日付としては出さない）
    .sort((a, b) => Date.parse(b.decidedAt ?? b.task.updated_at) - Date.parse(a.decidedAt ?? a.task.updated_at))

  // 完了した検討中（決めずに取り下げたもの）は、これから決めるものではないので出さない
  const considering = specTasks
    .filter((t) => !isDecided(t) && t.status !== 'done')
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))

  // 何行だけ出して残りを「すべて表示」に畳むかは画面側（DecisionsSection）が決める。
  // ここで切ると、見出しの件数と開いたときの行数が食い違う
  return { decided, considering }
}

/** 決まった日。今年なら「9/12」、年をまたいだら「2025/12/20」。日本時間で切る。 */
export function formatDecidedDate(isoDate: string, currentYear: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(isoDate))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const year = Number(get('year'))
  const md = `${Number(get('month'))}/${Number(get('day'))}`
  return year === currentYear ? md : `${year}/${md}`
}
