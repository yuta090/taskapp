'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PortalShell, ActionCard, PortalTaskInspector } from '@/components/portal'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface Task {
  id: string
  title: string
  description?: string | null
  status: string
  dueDate?: string | null
  isOverdue?: boolean
  waitingDays?: number
  type?: 'task' | 'spec'
  createdAt?: string
}

interface PortalTasksClientProps {
  currentProject: Project
  projects: Project[]
  tasks: Task[]
  actionCount?: number
}

// Task processing states for visual feedback
type TaskState = 'processing' | 'done' | 'error'

export function PortalTasksClient({
  currentProject,
  projects,
  tasks,
  actionCount = 0,
}: PortalTasksClientProps) {
  const router = useRouter()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  // Track per-task processing state for visual feedback
  const [taskStates, setTaskStates] = useState<Map<string, TaskState>>(new Map())
  const [, startTransition] = useTransition()

  // Filter out completed tasks, show processing ones with animation
  const visibleTasks = tasks.filter(t => taskStates.get(t.id) !== 'done')

  const setTaskState = (taskId: string, state: TaskState | null) => {
    setTaskStates(prev => {
      const next = new Map(prev)
      if (state === null) {
        next.delete(taskId)
      } else {
        next.set(taskId, state)
      }
      return next
    })
  }

  const handleApprove = useCallback(async (taskId: string, comment: string) => {
    // Guard: prevent duplicate submissions
    if (taskStates.get(taskId) === 'processing') return

    // Phase 1: Show processing state (brief visual feedback)
    setTaskState(taskId, 'processing')
    setSelectedTask(null)

    try {
      const response = await fetch(`/api/portal/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', comment }),
      })

      if (!response.ok) {
        // Revert: show task again
        setTaskState(taskId, null)
        if (response.status === 409) {
          alert('タスクの状態が変更されました。ページを再読み込みします。')
        }
        startTransition(() => router.refresh())
        return
      }

      // Phase 2: Success — mark done then fade out
      setTaskState(taskId, 'done')
      startTransition(() => router.refresh())
    } catch (error) {
      console.error('Approve failed:', error)
      setTaskState(taskId, null)
      startTransition(() => router.refresh())
    }
  }, [router, taskStates])

  const handleRequestChanges = useCallback(async (taskId: string, comment: string) => {
    if (taskStates.get(taskId) === 'processing') return

    setTaskState(taskId, 'processing')
    setSelectedTask(null)

    try {
      const response = await fetch(`/api/portal/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_changes', comment }),
      })

      if (!response.ok) {
        setTaskState(taskId, null)
        const error = await response.json()
        if (response.status === 409) {
          alert('タスクの状態が変更されました。ページを再読み込みします。')
        } else if (response.status === 400 && error.error?.includes('Comment')) {
          alert('コメントを入力してください。')
        }
        startTransition(() => router.refresh())
        return
      }

      setTaskState(taskId, 'done')
      startTransition(() => router.refresh())
    } catch (error) {
      console.error('Request changes failed:', error)
      setTaskState(taskId, null)
      startTransition(() => router.refresh())
    }
  }, [router, taskStates])

  const handleSelectTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      setSelectedTask(task)
    }
  }

  // Group visible tasks by status (optimistic removal applied)
  const consideringTasks = visibleTasks.filter(t => t.status === 'considering')
  const otherTasks = visibleTasks.filter(t => t.status !== 'considering')

  // Inspector content
  const inspector = selectedTask ? (
    <PortalTaskInspector
      task={selectedTask}
      onClose={() => setSelectedTask(null)}
      onApprove={handleApprove}
      onRequestChanges={handleRequestChanges}
    />
  ) : null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
      inspector={inspector}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Page Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">要対応タスク</h1>
            <p className="mt-1 text-sm text-gray-600">
              確認・承認が必要なタスクの一覧です
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-bold text-gray-900">{visibleTasks.length}</div>
              <div className="text-sm text-gray-500">全体</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-bold text-amber-600">{consideringTasks.length}</div>
              <div className="text-sm text-gray-500">要確認</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-bold text-red-600">
                {visibleTasks.filter(t => t.isOverdue).length}
              </div>
              <div className="text-sm text-gray-500">期限切れ</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-bold text-gray-600">{otherTasks.length}</div>
              <div className="text-sm text-gray-500">対応待ち</div>
            </div>
          </div>

          {/* Task List */}
          {visibleTasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <div className="text-gray-400 text-4xl mb-3">✓</div>
              <p className="text-gray-600">確認が必要なタスクはありません</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Considering Tasks (Priority) */}
              {consideringTasks.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-amber-700 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    要確認 ({consideringTasks.length}件)
                  </h2>
                  <div className="space-y-3">
                    {consideringTasks.map((task) => (
                      <ActionCard
                        key={task.id}
                        id={task.id}
                        title={task.title}
                        dueDate={task.dueDate}
                        isOverdue={task.isOverdue}
                        waitingDays={task.waitingDays}
                        type={task.type}
                        selected={selectedTask?.id === task.id}
                        processing={taskStates.get(task.id) === 'processing'}
                        onApprove={handleApprove}
                        onRequestChanges={handleRequestChanges}
                        onViewDetail={handleSelectTask}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Other Tasks */}
              {otherTasks.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                    対応待ち ({otherTasks.length}件)
                  </h2>
                  <div className="space-y-3">
                    {otherTasks.map((task) => (
                      <ActionCard
                        key={task.id}
                        id={task.id}
                        title={task.title}
                        dueDate={task.dueDate}
                        isOverdue={task.isOverdue}
                        waitingDays={task.waitingDays}
                        type={task.type}
                        selected={selectedTask?.id === task.id}
                        processing={taskStates.get(task.id) === 'processing'}
                        onApprove={handleApprove}
                        onRequestChanges={handleRequestChanges}
                        onViewDetail={handleSelectTask}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
