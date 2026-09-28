/**
 * マイタスクの一覧に並べる行（見出し＋タスク）。
 *
 * 絞り込み・並べ方・見出しの分け方は Web のマイタスクと同じもの（src/lib/tasks/myTaskViews.ts）を使う。
 * スマホは「いま手を付けるもの」を見る場面なので、表示は「アクティブ（未着手・完了を除く）×期限別×期限の近い順」に固定し、
 * 切り替えはボール（自分たちの番か）だけにする。
 */
import {
  buildMyTaskSections,
  DEFAULT_MY_TASK_VIEW,
  filterMyTasks,
  sortMyTasks,
  type MyTaskBallFilter,
} from '@/lib/tasks/myTaskViews'
import type { Milestone, ReviewStatus, Space, Task } from '@/types/database'

export type MyTaskListItem =
  | { kind: 'header'; key: string; label: string; count: number; tone: 'default' | 'danger' }
  | {
      kind: 'task'
      key: string
      task: Task
      spaceName: string | null
      reviewStatus: ReviewStatus | undefined
      awaitingMyApproval: boolean
    }

export interface MyTaskListSource {
  tasks: Task[]
  reviewStatuses: Record<string, ReviewStatus>
  spaces: Space[]
  milestones: Milestone[]
}

export function buildMyTaskListItems(
  data: MyTaskListSource,
  view: { ball: MyTaskBallFilter },
  today: string,
  pendingReviewTaskIds: ReadonlySet<string>
): MyTaskListItem[] {
  const filtered = filterMyTasks(
    data.tasks,
    { tab: 'active', ball: view.ball, spaceId: null, unreadOnly: false },
    () => 0
  )
  const sorted = sortMyTasks(filtered, DEFAULT_MY_TASK_VIEW.sortField, DEFAULT_MY_TASK_VIEW.sortOrder)
  const sections = buildMyTaskSections(sorted, 'due', {
    spaces: data.spaces,
    milestones: data.milestones,
    today,
  })
  const spaceNames = new Map(data.spaces.map((s) => [s.id, s.name]))

  const items: MyTaskListItem[] = []
  for (const section of sections) {
    for (const group of section.groups) {
      items.push({ kind: 'header', key: group.key, label: group.label, count: group.tasks.length, tone: group.tone })
      for (const task of group.tasks) {
        items.push({
          kind: 'task',
          key: `${group.key}:${task.id}`,
          task,
          spaceName: spaceNames.get(task.space_id) ?? null,
          reviewStatus: data.reviewStatuses[task.id],
          awaitingMyApproval: pendingReviewTaskIds.has(task.id),
        })
      }
    }
  }
  return items
}
