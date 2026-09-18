/**
 * 受信トレイなど、プロジェクトの一覧の外でタスクの状態を変えたときに、一覧のキャッシュを合わせる。
 *
 * 合わせないと「受信トレイでは完了なのに、プロジェクトのタスク一覧では社内承認中」が
 * 最大2分（QueryProvider の staleTime）続く。かといって invalidate すると、そのプロジェクトの
 * タスクを1000件ずつ全件読み直す重い取得が走る。そこで**該当タスクの行だけ**を書き換える。
 *
 * 取得時刻（dataUpdatedAt）は据え置く。1行直しただけで一覧を読み直したわけではないので、
 * 更新したことにすると、前日の永続キャッシュが「今取れたばかり」に見えてしまい、
 * マイタスク側の新旧判定と裏の取り直しが飛ぶ（MyTasksClient の updateTaskStatus と同じ考え方）。
 */

import type { QueryClient } from '@tanstack/react-query'
import type { Task } from '@/types/database'

interface TasksCacheShape {
  tasks: Task[]
  owners: Record<string, unknown>
  reviewStatuses: Record<string, unknown>
}

interface PatchTaskRowParams {
  orgId: string | null | undefined
  spaceId: string | null | undefined
  taskId: string
  patch: Partial<Task>
}

export function patchTaskRowInProjectCache(
  queryClient: QueryClient,
  { orgId, spaceId, taskId, patch }: PatchTaskRowParams
): void {
  if (!orgId || !spaceId) return
  const key = ['tasks', orgId, spaceId] as const

  queryClient.setQueryData<TasksCacheShape>(
    key,
    (old) => {
      if (!old) return old
      return {
        ...old,
        tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, ...withCompletedAt(t, patch) } : t)),
      }
    },
    { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt }
  )
}

/**
 * 完了日時は DB のトリガー（trg_task_completed_at）が入れる。画面の先出しでも同じ値にする
 * （詳細パネルの完了日と、遅れの集計がこれを読む）
 */
function withCompletedAt(task: Task, patch: Partial<Task>): Partial<Task> {
  if (patch.status === undefined || patch.completed_at !== undefined) return patch
  if (patch.status === 'done') {
    return { ...patch, completed_at: task.completed_at ?? new Date().toISOString() }
  }
  if (task.status === 'done') {
    return { ...patch, completed_at: null }
  }
  return patch
}
