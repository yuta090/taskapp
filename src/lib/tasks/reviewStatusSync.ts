/**
 * 社内承認の依頼が変わったときに、一覧のキャッシュをどう書き換えるか。
 *
 * DB 側は `trg_sync_task_status_on_review_open` が「依頼が open になったら
 * タスクを in_review にする（done は除く）」を行い、承認が全員そろったときは
 * `_review_approve_impl`（20260918162535_review_auto_complete.sql）がタスクを完了にする。
 * 画面はサーバーの返事を待たずに一覧を更新するので、**同じ判断をここでも行う**。
 * 揃えないと、依頼・承認したのに一覧の状態が変わらず、次の取得までずれたままになる。
 */

import type { Task, TaskOwner } from '@/types/database'
import type { ReviewStatus } from '@/lib/supabase/queries'

export interface TasksCacheShape {
  tasks: Task[]
  owners: Record<string, TaskOwner[]>
  reviewStatuses: Record<string, ReviewStatus>
}

export function applyReviewChange(
  old: TasksCacheShape,
  taskId: string,
  status: string | null,
  /** 承認がそろって、DB 側がこのタスクを完了にしたか（rpc_review_approve の taskCompleted） */
  taskCompleted = false
): TasksCacheShape {
  const nextReviews = { ...old.reviewStatuses }
  if (!status) {
    delete nextReviews[taskId]
  } else {
    nextReviews[taskId] = status as ReviewStatus
  }

  // 返事待ちになったときだけ社内承認中に進める。差し戻し・取消では動かさない
  // （差し戻しは直す作業が続くので社内承認中のまま）。
  const shouldMarkInReview =
    status === 'open' &&
    old.tasks.some((t) => t.id === taskId && t.status !== 'in_review' && t.status !== 'done')

  // 承認がそろって DB 側が完了にしたときは、一覧も完了にする。完了日時も入れる
  // （詳細パネルの完了日と、遅れの集計（calculateRisk）がこれを読む）
  const completedAt = new Date().toISOString()

  const nextTasks = taskCompleted
    ? old.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'done' as const, completed_at: t.completed_at ?? completedAt } : t
      )
    : shouldMarkInReview
      ? old.tasks.map((t) => (t.id === taskId ? { ...t, status: 'in_review' as const } : t))
      : old.tasks

  return {
    tasks: nextTasks,
    owners: old.owners,
    reviewStatuses: nextReviews,
  }
}
