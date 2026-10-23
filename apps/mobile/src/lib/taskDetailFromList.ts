/**
 * マイタスクの一覧（取り置き済み）から、タスク詳細の形を組み立てる。
 *
 * タスク詳細画面を開いた瞬間、通信を待たずに描くための placeholderData に使う
 * （`~/hooks/queries.ts` の `useTaskDetail`）。マイタスクと、プロジェクトのタスクの取り置きの両方を見る。型だけ `~/api/tasks` から取る
 * （値を import すると Supabase のクライアントまで読み込まれてしまう）。
 */
import type { Space } from '@/types/database'
import type { MyTasksData, TaskDetail } from '~/api/tasks'
import type { ProjectTaskListSource } from './projectTaskList'

export function taskDetailFromList(data: MyTasksData | undefined, taskId: string): TaskDetail | undefined {
  if (!data) return undefined
  const task = data.tasks.find((t) => t.id === taskId)
  if (!task) return undefined
  const spaceName = data.spaces.find((s) => s.id === task.space_id)?.name ?? null
  return { task, reviewStatus: data.reviewStatuses[taskId], spaceName }
}

/**
 * マイタスクとプロジェクトのタスクの取り置きから、最初に見つかったタスクを返す。
 * プロジェクトのタスクの取り置きはプロジェクト名を持たないので、プロジェクト一覧の取り置き（spaces）から引く。
 */
export function taskDetailFromSources(
  myTasks: MyTasksData | undefined,
  projectTasks: readonly (ProjectTaskListSource | undefined)[],
  spaces: readonly Space[] | undefined,
  taskId: string
): TaskDetail | undefined {
  const mine = taskDetailFromList(myTasks, taskId)
  if (mine) return mine
  for (const data of projectTasks) {
    const task = data?.tasks.find((t) => t.id === taskId)
    if (!task) continue
    const spaceName = spaces?.find((s) => s.id === task.space_id)?.name ?? null
    return { task, reviewStatus: data!.reviewStatuses[taskId], spaceName }
  }
  return undefined
}
