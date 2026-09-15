import type { Task } from '@/types/database'
import { dueBucketOf } from '@/lib/tasks/myTaskViews'

/**
 * ダッシュボードの「期限切れ」。期限が日本時間の今日より前で、まだ完了していないタスクを
 * 承認待ち・クライアント確認待ち・それ以外（タスク）に分ける。
 *
 * 「期限切れ」の判定はマイタスクの期限別（dueBucketOf）と同じものを使う。画面ごとに数え方が
 * ずれると、ダッシュボードとマイタスクで件数が合わなくなる。
 *
 * 1件はどれか1つにだけ入れる。同じタスクが2か所に並ぶと、見出しの件数の合計が上の「期限超過」と
 * 合わなくなるため。承認待ちとクライアント確認待ちの両方に当たるときは承認待ちに入れる
 * （社内承認はボールの向きに関係なく社内で止まっている）。
 */

export type OverdueKind = 'review' | 'client' | 'task'

export interface OverdueItem {
  task: Task
  kind: OverdueKind
  /** 期限から何日過ぎたか（昨日が期限なら1） */
  daysOverdue: number
}

export interface OverdueGroups {
  review: OverdueItem[]
  client: OverdueItem[]
  task: OverdueItem[]
  total: number
}

const NO_OPEN_REVIEWS: ReadonlySet<string> = new Set()

/**
 * どの見出しに入れるか。openReviewTaskIds は返事待ち（open）の承認依頼があるタスクの id。
 * 依頼すると状態が自動で in_review になるが、その仕組みより前（2026-09-14 より前）に作った
 * 依頼は状態が古いまま残っているので、依頼の側からも拾う。
 */
export function overdueKindOf(
  task: Pick<Task, 'id' | 'status' | 'ball'>,
  openReviewTaskIds: ReadonlySet<string>
): OverdueKind {
  if (task.status === 'in_review' || openReviewTaskIds.has(task.id)) return 'review'
  if (task.ball === 'client') return 'client'
  return 'task'
}

// 'YYYY-MM-DD' を UTC の0時として数にする。年月日の成分だけで作るので、実行環境のタイムゾーンに左右されない
function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** 期限（日付の部分だけを使う）から today まで何日過ぎたか。 */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.round((ymdToUtcMs(today) - ymdToUtcMs(dueDate)) / 86_400_000)
}

/**
 * 期限切れを3つに分ける。today は日本時間の今日（呼び出し側で jstNow から作る）。
 * それぞれの中は、長く過ぎているもの（期限が古いもの）から並べる。
 */
export function groupOverdueTasks(
  tasks: readonly Task[],
  today: string,
  openReviewTaskIds: ReadonlySet<string> = NO_OPEN_REVIEWS
): OverdueGroups {
  const groups: OverdueGroups = { review: [], client: [], task: [], total: 0 }

  const overdue = tasks
    .filter((task) => dueBucketOf(task, today) === 'overdue')
    .sort((a, b) => a.due_date!.slice(0, 10).localeCompare(b.due_date!.slice(0, 10)))

  for (const task of overdue) {
    const kind = overdueKindOf(task, openReviewTaskIds)
    groups[kind].push({ task, kind, daysOverdue: daysOverdue(task.due_date!, today) })
    groups.total += 1
  }

  return groups
}
