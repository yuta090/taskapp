/**
 * マイタスクの一覧（取り置き済み）から、タスク詳細の形を組み立てる。
 *
 * タスク詳細画面を開いた瞬間、通信を待たずに描くための placeholderData に使う
 * （`~/hooks/queries.ts` の `useTaskDetail`）。型だけ `~/api/tasks` から取る
 * （値を import すると Supabase のクライアントまで読み込まれてしまう）。
 */
import type { MyTasksData, TaskDetail } from '~/api/tasks'

export function taskDetailFromList(data: MyTasksData | undefined, taskId: string): TaskDetail | undefined {
  if (!data) return undefined
  const task = data.tasks.find((t) => t.id === taskId)
  if (!task) return undefined
  const spaceName = data.spaces.find((s) => s.id === task.space_id)?.name ?? null
  return { task, reviewStatus: data.reviewStatuses[taskId], spaceName }
}
