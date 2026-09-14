/**
 * 社内承認の依頼が変わったときに、一覧のキャッシュをどう書き換えるか。
 *
 * DB 側は `trg_sync_task_status_on_review_open` が「依頼が open になったら
 * タスクを in_review にする（done は除く）」を行う。画面はサーバーの返事を待たずに
 * 一覧を更新するので、**同じ判断をここでも行う**。揃えないと、依頼したのに一覧の状態が
 * 変わらず、次の取得までずれたままになる。
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
  status: string | null
): TasksCacheShape {
  const nextReviews = { ...old.reviewStatuses }
  if (!status) {
    delete nextReviews[taskId]
  } else {
    nextReviews[taskId] = status as ReviewStatus
  }

  // 返事待ちになったときだけ状態を進める。承認・差し戻し・取消では動かさない
  // （完了にするかは人が決める。差し戻しは直す作業が続くので社内承認中のまま）。
  const shouldMarkInReview =
    status === 'open' &&
    old.tasks.some((t) => t.id === taskId && t.status !== 'in_review' && t.status !== 'done')

  return {
    tasks: shouldMarkInReview
      ? old.tasks.map((t) => (t.id === taskId ? { ...t, status: 'in_review' as const } : t))
      : old.tasks,
    owners: old.owners,
    reviewStatuses: nextReviews,
  }
}
