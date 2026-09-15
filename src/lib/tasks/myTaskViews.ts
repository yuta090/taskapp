import type { Milestone, Space, Task, TaskStatus } from '@/types/database'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * マイタスク（/my）の表示の切り替え。タブ（すべて・アクティブ・未着手・完了）・まとめ方
 * （期限別・プロジェクト別・マイルストーン別・ステータス別）・ボール・未読コメントで絞る。
 *
 * マイタスクは複数のプロジェクトにまたがるので、プロジェクトのタスク一覧（TasksPageClient）とは
 * まとめ方の中身が違う（期限別がある・マイルストーンの見出しにプロジェクト名を添える）。
 */

export type MyTaskTab = 'all' | 'active' | 'backlog' | 'done'
export type MyTaskGroupBy = 'due' | 'project' | 'milestone' | 'status'
/** ボールで絞る。external は社内以外（クライアント・ベンダー・代理店）にあるもの */
export type MyTaskBallFilter = 'all' | 'internal' | 'external'
export type MyTaskSortField = 'due_date' | 'created_at' | 'priority' | 'title'
export type MyTaskSortOrder = 'asc' | 'desc'

export interface MyTaskViewState {
  tab: MyTaskTab
  groupBy: MyTaskGroupBy
  ball: MyTaskBallFilter
  spaceId: string | null
  unreadOnly: boolean
  sortField: MyTaskSortField
  sortOrder: MyTaskSortOrder
}

export const DEFAULT_MY_TASK_VIEW: MyTaskViewState = {
  tab: 'active',
  groupBy: 'due',
  ball: 'all',
  spaceId: null,
  unreadOnly: false,
  sortField: 'due_date',
  sortOrder: 'asc',
}

const TABS: readonly MyTaskTab[] = ['all', 'active', 'backlog', 'done']
const GROUP_BYS: readonly MyTaskGroupBy[] = ['due', 'project', 'milestone', 'status']
const BALLS: readonly MyTaskBallFilter[] = ['all', 'internal', 'external']
const SORT_FIELDS: readonly MyTaskSortField[] = ['due_date', 'created_at', 'priority', 'title']
const SORT_ORDERS: readonly MyTaskSortOrder[] = ['asc', 'desc']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * 端末（localStorage）に保存した表示の設定を読む。前の形（status / showCompleted）や
 * 知らない値は使わず、項目ごとに既定へ戻す。
 */
export function parseMyTaskViewState(raw: unknown): MyTaskViewState {
  if (!raw || typeof raw !== 'object') return DEFAULT_MY_TASK_VIEW
  const r = raw as Record<string, unknown>
  return {
    tab: pick(r.tab, TABS, DEFAULT_MY_TASK_VIEW.tab),
    groupBy: pick(r.groupBy, GROUP_BYS, DEFAULT_MY_TASK_VIEW.groupBy),
    ball: pick(r.ball, BALLS, DEFAULT_MY_TASK_VIEW.ball),
    spaceId: typeof r.spaceId === 'string' ? r.spaceId : null,
    unreadOnly: r.unreadOnly === true,
    sortField: pick(r.sortField, SORT_FIELDS, DEFAULT_MY_TASK_VIEW.sortField),
    sortOrder: pick(r.sortOrder, SORT_ORDERS, DEFAULT_MY_TASK_VIEW.sortOrder),
  }
}

function matchesTab(status: TaskStatus, tab: MyTaskTab): boolean {
  switch (tab) {
    case 'active':
      return status !== 'backlog' && status !== 'done'
    case 'backlog':
      return status === 'backlog'
    case 'done':
      return status === 'done'
    default:
      return true
  }
}

export function filterMyTasks(
  tasks: Task[],
  view: Pick<MyTaskViewState, 'tab' | 'ball' | 'spaceId' | 'unreadOnly'>,
  unreadCountOf: (taskId: string) => number
): Task[] {
  return tasks.filter((task) => {
    if (!matchesTab(task.status, view.tab)) return false
    if (view.ball === 'internal' && task.ball !== 'internal') return false
    if (view.ball === 'external' && task.ball === 'internal') return false
    if (view.spaceId && task.space_id !== view.spaceId) return false
    if (view.unreadOnly && unreadCountOf(task.id) < 1) return false
    return true
  })
}

/** 値が無いもの（期限なし・優先度なし）は、昇順でも降順でも最後に置く */
function compareEmptyLast<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  compare: (x: T, y: T) => number,
  order: MyTaskSortOrder
): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  const result = compare(a as T, b as T)
  return order === 'asc' ? result : -result
}

export function sortMyTasks(tasks: Task[], field: MyTaskSortField, order: MyTaskSortOrder): Task[] {
  return [...tasks].sort((a, b) => {
    switch (field) {
      case 'due_date':
        return compareEmptyLast(a.due_date?.slice(0, 10), b.due_date?.slice(0, 10), (x, y) => x.localeCompare(y), order)
      case 'created_at':
        return compareEmptyLast(a.created_at, b.created_at, (x, y) => x.localeCompare(y), order)
      case 'priority':
        return compareEmptyLast(a.priority, b.priority, (x, y) => x - y, order)
      case 'title':
        return compareEmptyLast(a.title, b.title, (x, y) => x.localeCompare(y, 'ja'), order)
    }
  })
}

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'no_date' | 'done'

// 日付は 'YYYY-MM-DD' の文字列のまま比べる。足し算だけ、その場の年月日から Date を作って行う
// （年月日の成分で作って成分で戻すので、実行環境のタイムゾーンに左右されない）
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return formatDateToLocalString(new Date(y, m - 1, d + days))
}

/** その週の日曜日（週は月曜はじまり。今日が日曜なら今日） */
function endOfWeek(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dayOfWeek = new Date(y, m - 1, d).getDay()
  return addDays(ymd, (7 - dayOfWeek) % 7)
}

/**
 * 期限別の見出しに振り分ける。today は日本時間の今日（呼び出し側で jstNow から作る）。
 * 完了したタスクは期限に関係なく「完了」にまとめる（期限切れに並ぶと、終わったものが目に入り続ける）。
 */
export function dueBucketOf(task: Pick<Task, 'status' | 'due_date'>, today: string): DueBucket {
  if (task.status === 'done') return 'done'
  if (!task.due_date) return 'no_date'
  const due = task.due_date.slice(0, 10)
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  if (due === addDays(today, 1)) return 'tomorrow'
  if (due <= endOfWeek(today)) return 'this_week'
  return 'later'
}

export interface MyTaskGroup {
  /** 畳んだ状態を覚えるキー。プロジェクト別は前の形（spaceId:milestoneId）のまま */
  key: string
  label: string
  /** 見出しの横に小さく出す補足（マイルストーンの期限・プロジェクト名） */
  meta: string | null
  tone: 'default' | 'danger'
  tasks: Task[]
}

export interface MyTaskSection {
  key: string
  /** プロジェクト別のときだけプロジェクト名。ほかは見出しの段が1つなので null */
  label: string | null
  groups: MyTaskGroup[]
}

export interface MyTaskSectionContext {
  spaces: Space[]
  milestones: Milestone[]
  /** 日本時間の今日（YYYY-MM-DD） */
  today: string
}

const DUE_BUCKET_LABELS: { bucket: DueBucket; label: string }[] = [
  { bucket: 'overdue', label: '期限切れ' },
  { bucket: 'today', label: '今日' },
  { bucket: 'tomorrow', label: '明日' },
  { bucket: 'this_week', label: '今週' },
  { bucket: 'later', label: '来週以降' },
  { bucket: 'no_date', label: '期限なし' },
  { bucket: 'done', label: '完了' },
]

const STATUS_LABELS: Record<TaskStatus, string> = {
  in_progress: '進行中',
  todo: '着手予定',
  in_review: '社内承認中',
  considering: '検討中',
  backlog: '未着手',
  done: '完了',
}
const STATUS_ORDER: TaskStatus[] = ['in_progress', 'todo', 'in_review', 'considering', 'backlog', 'done']

const NO_SPACE_KEY = 'no-space'
const NO_MILESTONE_KEY = 'no-milestone'

/** キーごとにまとめる。キーの中は渡した順（並び替え済み）を保つ */
function bucketize<K>(tasks: Task[], keyOf: (task: Task) => K): Map<K, Task[]> {
  const map = new Map<K, Task[]>()
  for (const task of tasks) {
    const key = keyOf(task)
    const list = map.get(key)
    if (list) list.push(task)
    else map.set(key, [task])
  }
  return map
}

function formatMonthDay(ymd: string | null | undefined): string | null {
  if (!ymd) return null
  const [, m, d] = ymd.slice(0, 10).split('-')
  return `${Number(m)}/${Number(d)}`
}

/** マイルストーンの期限の早い順（期限なしは後ろ）→ 並び順 → 名前 */
function compareMilestones(a: Milestone, b: Milestone): number {
  return (
    compareEmptyLast(a.due_date, b.due_date, (x, y) => x.localeCompare(y), 'asc') ||
    a.order_key - b.order_key ||
    a.name.localeCompare(b.name, 'ja')
  )
}

function groupByDue(tasks: Task[], today: string): MyTaskGroup[] {
  const buckets = bucketize(tasks, (task) => dueBucketOf(task, today))
  return DUE_BUCKET_LABELS.flatMap(({ bucket, label }) => {
    const list = buckets.get(bucket)
    if (!list) return []
    return [{ key: `due:${bucket}`, label, meta: null, tone: bucket === 'overdue' ? 'danger' : 'default', tasks: list }]
  })
}

function groupByStatus(tasks: Task[]): MyTaskGroup[] {
  const buckets = bucketize(tasks, (task) => task.status)
  const known = STATUS_ORDER.filter((status) => buckets.has(status))
  const unknown = [...buckets.keys()].filter((status) => !STATUS_ORDER.includes(status))
  return [...known, ...unknown].map((status) => ({
    key: `status:${status}`,
    label: STATUS_LABELS[status] ?? status,
    meta: null,
    tone: 'default',
    tasks: buckets.get(status) ?? [],
  }))
}

function groupByProject(tasks: Task[], ctx: MyTaskSectionContext): MyTaskSection[] {
  const spaceById = new Map(ctx.spaces.map((s) => [s.id, s]))
  const milestoneById = new Map(ctx.milestones.map((m) => [m.id, m]))
  // 削除済みなど、一覧に無いマイルストーンを指すタスクは「未設定」にまとめる
  const milestoneOf = (task: Task) => (task.milestone_id ? milestoneById.get(task.milestone_id) ?? null : null)

  const sections = [...bucketize(tasks, (task) => task.space_id || NO_SPACE_KEY)].map(([spaceId, spaceTasks]) => {
    const groups = [...bucketize(spaceTasks, milestoneOf)]
      .sort(([a], [b]) => (a && b ? compareMilestones(a, b) : a ? -1 : b ? 1 : 0))
      .map(
        ([milestone, list]): MyTaskGroup => ({
          key: `${spaceId}:${milestone?.id ?? NO_MILESTONE_KEY}`,
          label: milestone?.name ?? 'マイルストーン未設定',
          meta: formatMonthDay(milestone?.due_date),
          tone: 'default',
          tasks: list,
        })
      )
    return { space: spaceById.get(spaceId) ?? null, section: { key: spaceId, label: '', groups } }
  })

  return sections
    .sort((a, b) => (a.space && b.space ? a.space.name.localeCompare(b.space.name, 'ja') : a.space ? -1 : b.space ? 1 : 0))
    .map(({ space, section }) => ({ ...section, label: space?.name ?? 'プロジェクト未設定' }))
}

function groupByMilestone(tasks: Task[], ctx: MyTaskSectionContext): MyTaskGroup[] {
  const spaceNameById = new Map(ctx.spaces.map((s) => [s.id, s.name]))
  const milestoneById = new Map(ctx.milestones.map((m) => [m.id, m]))
  const milestoneOf = (task: Task) => (task.milestone_id ? milestoneById.get(task.milestone_id) ?? null : null)

  return [...bucketize(tasks, milestoneOf)]
    .sort(([a], [b]) => {
      if (!a || !b) return a ? -1 : b ? 1 : 0
      return (
        compareMilestones(a, b) ||
        (spaceNameById.get(a.space_id) ?? '').localeCompare(spaceNameById.get(b.space_id) ?? '', 'ja')
      )
    })
    .map(([milestone, list]) => ({
      key: `ms:${milestone?.id ?? 'none'}`,
      label: milestone?.name ?? 'マイルストーン未設定',
      meta: milestone
        ? [spaceNameById.get(milestone.space_id), formatMonthDay(milestone.due_date)].filter(Boolean).join(' · ') || null
        : null,
      tone: 'default',
      tasks: list,
    }))
}

/**
 * 並び替え済みのタスクを見出しに分ける。プロジェクト別だけは「プロジェクト → マイルストーン」の2段で、
 * ほかは見出しが1段（section は1つで label が null）。
 */
export function buildMyTaskSections(
  tasks: Task[],
  groupBy: MyTaskGroupBy,
  ctx: MyTaskSectionContext
): MyTaskSection[] {
  if (tasks.length === 0) return []
  switch (groupBy) {
    case 'due':
      return [{ key: 'due', label: null, groups: groupByDue(tasks, ctx.today) }]
    case 'status':
      return [{ key: 'status', label: null, groups: groupByStatus(tasks) }]
    case 'milestone':
      return [{ key: 'milestone', label: null, groups: groupByMilestone(tasks, ctx) }]
    case 'project':
      return groupByProject(tasks, ctx)
  }
}
