import type { Task } from '@/types/database'
import { dueBucketOf } from '@/lib/tasks/myTaskViews'
import { isAwaitingReview } from '@/lib/tasks/quickFilters'

/**
 * ダッシュボードの「メンバー別」。担当者ごとに、状態別の件数・期限切れの数・残りのタスクを出す。
 *
 * 確認待ちは、タスク一覧の「レビュー待ち」と同じ判定（状態が確認待ちか、返事待ちの承認依頼がある）。
 * 期限切れは、ダッシュボードの「期限切れ」・タスク一覧の「期限切れ」と同じ判定。
 */

export type MemberBucket = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'

/** 棒の並び順（左から）と見出し */
export const MEMBER_BUCKETS: ReadonlyArray<{ key: MemberBucket; label: string }> = [
  { key: 'done', label: '完了' },
  { key: 'in_review', label: '確認待ち' },
  { key: 'in_progress', label: '進行中' },
  { key: 'todo', label: '着手予定' },
  { key: 'backlog', label: '未着手' },
]

export interface MemberProgressRow {
  /** 担当者の id。担当者のいないタスクをまとめた行は null */
  assigneeId: string | null
  counts: Record<MemberBucket, number>
  /** 完了していないタスクの数 */
  open: number
  overdue: number
  /** 完了していないタスク。期限の早い順（期限なしは最後） */
  openTasks: Task[]
}

function bucketOf(task: Task, openReviewTaskIds: ReadonlySet<string>): MemberBucket {
  if (task.status === 'done') return 'done'
  if (isAwaitingReview(task, openReviewTaskIds)) return 'in_review'
  if (task.status === 'todo') return 'todo'
  if (task.status === 'in_progress') return 'in_progress'
  // backlog と検討中（considering）は、まだ手を付けていないものとして未着手に入れる
  return 'backlog'
}

function compareDue(a: Task, b: Task): number {
  if (a.due_date && b.due_date) return a.due_date.slice(0, 10).localeCompare(b.due_date.slice(0, 10))
  if (a.due_date) return -1
  if (b.due_date) return 1
  return 0
}

export function summarizeByMember(
  tasks: readonly Task[],
  today: string,
  openReviewTaskIds: ReadonlySet<string>
): MemberProgressRow[] {
  const rows = new Map<string | null, MemberProgressRow>()

  for (const task of tasks) {
    const key = task.assignee_id ?? null
    let row = rows.get(key)
    if (!row) {
      row = {
        assigneeId: key,
        counts: { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0 },
        open: 0,
        overdue: 0,
        openTasks: [],
      }
      rows.set(key, row)
    }
    const bucket = bucketOf(task, openReviewTaskIds)
    row.counts[bucket] += 1
    if (bucket !== 'done') {
      row.open += 1
      row.openTasks.push(task)
      if (dueBucketOf(task, today) === 'overdue') row.overdue += 1
    }
  }

  for (const row of rows.values()) row.openTasks.sort(compareDue)

  // 残りの多い人から。担当者なしは誰の仕事でもないので最後にまとめる
  return [...rows.values()].sort((a, b) => {
    if ((a.assigneeId === null) !== (b.assigneeId === null)) return a.assigneeId === null ? 1 : -1
    return b.open - a.open
  })
}
