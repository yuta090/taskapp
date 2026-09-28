'use client'

import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { TaskInspector } from '@/components/task/TaskInspector'
import { useTasks, type UpdateTaskInput } from '@/lib/hooks/useTasks'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import { invalidateSpecDecisionEvents } from '@/lib/hooks/useSpecDecisionEvents'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { getEligibleParents } from '@/lib/gantt/treeUtils'
import { buildChildTaskInput, type ChildTaskDraft } from '@/lib/tasks/childTask'
import type { BallSide, DecisionState, Task } from '@/types/database'

interface ProjectTaskInspectorProps {
  orgId: string
  spaceId: string
  taskId: string
  onClose: () => void
  /** 子タスクなど、詳細の中から別のタスクへ移るとき */
  onOpenTask: (taskId: string) => void
}

/**
 * タスク ID だけ渡せば、そのプロジェクトのタスク詳細を右パネルに出す。
 * タスクの一覧を持っていない画面（議事録）から、画面を移らずにタスクを開くのに使う。
 *
 * 一覧は useTasks で読む。タスク一覧・ガントと同じ入れ物（キャッシュ）なので、
 * 一度どこかで開いていれば待たずに出る。渡す操作はタスク一覧（TasksPageClient）と揃える。
 */
export function ProjectTaskInspector({ orgId, spaceId, taskId, onClose, onOpenTask }: ProjectTaskInspectorProps) {
  const queryClient = useQueryClient()
  const { tasks, owners, loading, fetchTasks, createTask, updateTask, deleteTask, passBall, handleReviewChange } =
    useTasks({ orgId, spaceId })
  // 閲覧者（viewer）・相手先には編集操作を渡さない（onUpdate 等が無ければ表示だけになる設計）
  const { canEdit, canEditMoney } = useCanEditSpace(spaceId, orgId)

  const task = useMemo(() => tasks.find((t) => t.id === taskId) ?? null, [tasks, taskId])

  const parentTasks = useMemo(
    () => (task ? getEligibleParents(tasks, task.id).map((t) => ({ id: t.id, title: t.title })) : []),
    [tasks, task]
  )
  const childTasks = useMemo(
    () => (task ? tasks.filter((t) => t.parent_task_id === task.id) : []),
    [tasks, task]
  )

  const ownerIdsOf = useCallback(
    (id: string, side: BallSide) => (owners[id] || []).filter((o) => o.side === side).map((o) => o.user_id),
    [owners]
  )

  const handlePassBall = useCallback(
    async (ball: BallSide, clientOwnerIds?: string[], internalOwnerIds?: string[]) => {
      const clientIds = clientOwnerIds ?? ownerIdsOf(taskId, 'client')
      const internalIds = internalOwnerIds ?? ownerIdsOf(taskId, 'internal')
      // バリデーションは TaskInspector 側で済んでいる（タスク一覧と同じく、念のためだけ残す）
      if (ball === 'client' && clientIds.length === 0) return
      await passBall(taskId, ball, clientIds, internalIds)
    },
    [ownerIdsOf, passBall, taskId]
  )

  const handleUpdate = useCallback(
    // 受け取った更新内容は詰め直さずにそのまま渡す（wikiPageIsSpec を落とすと、参考資料を
    // 紐づけただけで仕様タスクになり完了できなくなる）
    (updates: UpdateTaskInput) => updateTask(taskId, updates),
    [updateTask, taskId]
  )

  const handleUpdateOwners = useCallback(
    async (clientOwnerIds: string[], internalOwnerIds: string[]) => {
      if (!task) return
      await passBall(task.id, task.ball, clientOwnerIds, internalOwnerIds)
    },
    [task, passBall]
  )

  const handleCreateChild = useCallback(
    async (parent: Task, draft: ChildTaskDraft) => {
      await createTask(buildChildTaskInput(parent, draft))
      toast.success('子タスクを作成しました')
    },
    [createTask]
  )

  const handleDelete = useCallback(async () => {
    await deleteTask(taskId)
    onClose()
  }, [deleteTask, taskId, onClose])

  // 仕様タスクの確定・実装済み。中身はタスク一覧（TasksPageClient の handleSetSpecState）と同じ
  const handleSetSpecState = useCallback(
    async (decisionState: DecisionState) => {
      if (!task) throw new Error('Task not found')
      if (decisionState !== 'considering' && !task.wiki_page_id && !task.spec_path) {
        throw new Error('仕様書のWikiページが紐付けられていません')
      }
      await rpc.setSpecState(createClient(), { taskId: task.id, decisionState })
      await fetchTasks()
      // ダッシュボードの「確定事項」に出す「決まった日」を取り直させる
      invalidateSpecDecisionEvents(queryClient, spaceId)
    },
    [task, fetchTasks, queryClient, spaceId]
  )

  if (!task) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="flex items-center justify-end px-4 py-3 border-b border-gray-100">
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="text-lg" />
          </button>
        </div>
        <p className="px-4 py-6 text-sm text-gray-500">
          {loading ? '読み込み中…' : 'このタスクは見つかりませんでした（削除されたか、別のプロジェクトのタスクです）'}
        </p>
      </div>
    )
  }

  return (
    <TaskInspector
      task={task}
      spaceId={spaceId}
      owners={owners[task.id] || []}
      parentTasks={parentTasks}
      childTasks={childTasks}
      onOpenTask={onOpenTask}
      onClose={onClose}
      onPassBall={canEdit ? handlePassBall : undefined}
      onUpdate={canEdit ? handleUpdate : undefined}
      onCreateChild={canEdit ? (draft) => handleCreateChild(task, draft) : undefined}
      onDelete={canEdit ? handleDelete : undefined}
      onUpdateOwners={canEdit ? handleUpdateOwners : undefined}
      onSetSpecState={canEdit && task.type === 'spec' ? handleSetSpecState : undefined}
      onConsideringDecided={canEdit ? fetchTasks : undefined}
      onReviewChange={handleReviewChange}
      canEditPricing={canEditMoney}
    />
  )
}
