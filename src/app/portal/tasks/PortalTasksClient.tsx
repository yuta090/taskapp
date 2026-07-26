'use client'

import { useState } from 'react'
import { CheckCircle } from '@phosphor-icons/react'
import { PortalShell, ActionCard, PortalTaskInspector } from '@/components/portal'
import { usePortalTaskActions } from '@/lib/hooks/usePortalTaskActions'

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
  estimatedCost?: number | null
  estimateStatus?: 'none' | 'pending' | 'approved' | 'rejected'
}

interface PortalTasksClientProps {
  currentProject: Project
  projects: Project[]
  tasks: Task[]
  actionCount?: number
}

export function PortalTasksClient({
  currentProject,
  projects,
  tasks,
  actionCount = 0,
}: PortalTasksClientProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const {
    taskStates,
    handleApprove,
    handleRequestChanges,
    handleEstimateApprove,
    handleEstimateReject,
  } = usePortalTaskActions({ onActionStart: () => setSelectedTask(null) })

  // Filter out completed tasks, show processing ones with animation
  const visibleTasks = tasks.filter(t => taskStates.get(t.id) !== 'done')

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
      onEstimateApprove={handleEstimateApprove}
      onEstimateReject={handleEstimateReject}
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
            <h1 className="text-2xl font-semibold text-gray-900">要対応タスク</h1>
            <p className="mt-1 text-sm text-gray-600">
              確認・承認が必要なタスクの一覧です。「要確認」はすぐにアクションが必要、「チーム対応中」はチームが準備中です。
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-semibold text-gray-900">{visibleTasks.length}</div>
              <div className="text-sm text-gray-500">全体</div>
            </div>
            <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-semibold text-amber-600">{consideringTasks.length}</div>
              <div className="text-sm text-gray-500">要確認</div>
            </div>
            <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-semibold text-red-600">
                {visibleTasks.filter(t => t.isOverdue).length}
              </div>
              <div className="text-sm text-gray-500">期限切れ</div>
            </div>
            <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-semibold text-gray-600">{otherTasks.length}</div>
              <div className="text-sm text-gray-500">チーム対応中</div>
            </div>
          </div>

          {/* Task List */}
          {visibleTasks.length === 0 ? (
            <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">確認が必要なタスクはありません</p>
              <p className="text-sm text-gray-400 mt-1">
                チームから確認依頼があると、ここに表示されます
              </p>
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
                        estimatedCost={task.estimatedCost}
                        estimateStatus={task.estimateStatus}
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
                    チーム対応中 ({otherTasks.length}件)
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
                        estimatedCost={task.estimatedCost}
                        estimateStatus={task.estimateStatus}
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
