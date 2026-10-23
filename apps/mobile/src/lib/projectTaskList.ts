/**
 * プロジェクトのタスク画面に並べるタスク。
 *
 * 絞り込みの判定は Web のタスク一覧・ダッシュボードと同じもの（src/lib/tasks/quickFilters.ts）を使う。
 * 並びは取得順（作成が新しい順）のまま。
 */
import { applyQuickFilter, type QuickFilterKey } from '@/lib/tasks/quickFilters'
import type { ReviewStatus, Task } from '@/types/database'

/** 絞り込みチップの表示順とラベル（Web の TasksPageClient に合わせる） */
export const PROJECT_TASK_FILTERS: { key: QuickFilterKey; label: string }[] = [
  { key: 'active', label: 'アクティブ' },
  { key: 'all', label: 'すべて' },
  { key: 'backlog', label: '未着手' },
  { key: 'overdue', label: '期限切れ' },
  { key: 'in_review', label: 'レビュー待ち' },
  { key: 'client_wait', label: 'クライアント確認待ち' },
  { key: 'client_origin', label: 'クライアント起案' },
]

export interface ProjectTaskListSource {
  tasks: Task[]
  reviewStatuses: Record<string, ReviewStatus>
}

export function buildProjectTaskList(data: ProjectTaskListSource, filter: QuickFilterKey, today: string): Task[] {
  const openReviewTaskIds = new Set(
    Object.entries(data.reviewStatuses)
      .filter(([, status]) => status === 'open')
      .map(([taskId]) => taskId)
  )
  return applyQuickFilter(data.tasks, filter, { today, openReviewTaskIds })
}
