'use client'

import { useState, useMemo } from 'react'
import { ListChecks, Clock, CheckCircle, Circle, CaretRight, CaretDown } from '@phosphor-icons/react'
import { PortalShell, PortalTaskInspector } from '@/components/portal'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface Milestone {
  id: string
  name: string
  due_date: string | null
  order_key: number
}

interface Task {
  id: string
  title: string
  description?: string | null
  status: string
  ball: string
  dueDate?: string | null
  type?: 'task' | 'spec'
  createdAt?: string
  milestoneId?: string | null
}

interface PortalAllTasksClientProps {
  currentProject: Project
  projects: Project[]
  tasks: Task[]
  milestones: Milestone[]
  actionCount?: number
}

function getStatusInfo(status: string): { label: string; color: string; icon: React.ElementType } {
  const statusMap: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    done: { label: '完了', color: 'text-green-600', icon: CheckCircle },
    in_progress: { label: '進行中', color: 'text-blue-600', icon: Clock },
    considering: { label: '確認待ち', color: 'text-amber-600', icon: Circle },
    open: { label: 'オープン', color: 'text-gray-600', icon: Circle },
    todo: { label: 'Todo', color: 'text-gray-500', icon: Circle },
  }
  return statusMap[status] || { label: status, color: 'text-gray-500', icon: Circle }
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

function formatShortDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}/${day}`
}

export function PortalAllTasksClient({
  currentProject,
  projects,
  tasks,
  milestones,
  actionCount = 0,
}: PortalAllTasksClientProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const filteredTasks = tasks.filter(task => {
    if (filter === 'active') return task.status !== 'done'
    if (filter === 'done') return task.status === 'done'
    return true
  })

  const counts = {
    all: tasks.length,
    active: tasks.filter(t => t.status !== 'done').length,
    done: tasks.filter(t => t.status === 'done').length,
  }

  // Group tasks by milestone
  const groupedTasks = useMemo(() => {
    const milestoneMap = new Map(milestones.map(m => [m.id, m]))
    const groups: { milestone: Milestone | null; tasks: Task[] }[] = []

    // Create groups for each milestone
    const tasksByMilestone = new Map<string | null, Task[]>()

    for (const task of filteredTasks) {
      const key = task.milestoneId || null
      if (!tasksByMilestone.has(key)) {
        tasksByMilestone.set(key, [])
      }
      tasksByMilestone.get(key)!.push(task)
    }

    // Add milestone groups in order
    for (const milestone of milestones) {
      const milestoneTasks = tasksByMilestone.get(milestone.id)
      if (milestoneTasks && milestoneTasks.length > 0) {
        groups.push({ milestone, tasks: milestoneTasks })
      }
    }

    // Add unassigned tasks at the end
    const unassignedTasks = tasksByMilestone.get(null)
    if (unassignedTasks && unassignedTasks.length > 0) {
      groups.push({ milestone: null, tasks: unassignedTasks })
    }

    return groups
  }, [filteredTasks, milestones])

  const handleToggleGroup = (milestoneId: string | null) => {
    const key = milestoneId || '__none__'
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Convert to inspector format
  const inspectorTask = selectedTask ? {
    ...selectedTask,
    isOverdue: selectedTask.dueDate ? new Date(selectedTask.dueDate) < new Date() : false,
  } : null

  const inspector = inspectorTask ? (
    <PortalTaskInspector
      task={inspectorTask}
      onClose={() => setSelectedTask(null)}
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
            <h1 className="text-2xl font-bold text-gray-900">タスク一覧</h1>
            <p className="mt-1 text-sm text-gray-600">
              プロジェクトの全タスクを確認できます
            </p>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 border-b border-gray-200 pb-3">
            {[
              { key: 'all', label: 'すべて' },
              { key: 'active', label: '進行中' },
              { key: 'done', label: '完了' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key as typeof filter)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  filter === key
                    ? 'bg-amber-100 text-amber-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {label} ({counts[key as keyof typeof counts]})
              </button>
            ))}
          </div>

          {/* Task List with Milestone Groups */}
          {filteredTasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <ListChecks className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">タスクはありません</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {groupedTasks.map(({ milestone, tasks: groupTasks }) => {
                const groupKey = milestone?.id || '__none__'
                const isCollapsed = collapsedGroups.has(groupKey)

                return (
                  <div key={groupKey}>
                    {/* Milestone Group Header */}
                    <div
                      className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors select-none border-b border-gray-100 bg-gray-50/50"
                      onClick={() => handleToggleGroup(milestone?.id || null)}
                    >
                      {/* Collapse toggle */}
                      <div className="text-gray-400 w-4 flex justify-center">
                        {isCollapsed ? (
                          <CaretRight weight="bold" className="text-xs" />
                        ) : (
                          <CaretDown weight="bold" className="text-xs" />
                        )}
                      </div>

                      {/* Milestone name */}
                      <span className="text-[13px] font-semibold text-gray-800 tracking-tight">
                        {milestone?.name || 'マイルストーン未設定'}
                      </span>

                      {/* Due date */}
                      {milestone?.due_date && (
                        <span className="text-xs text-gray-400 tabular-nums">
                          {formatShortDate(milestone.due_date)}
                        </span>
                      )}

                      {/* Task count */}
                      <span className="text-xs text-gray-400 tabular-nums">
                        ({groupTasks.length})
                      </span>
                    </div>

                    {/* Tasks under this milestone */}
                    {!isCollapsed && (
                      <div className="divide-y divide-gray-100">
                        {groupTasks.map((task) => {
                          const statusInfo = getStatusInfo(task.status)
                          const StatusIcon = statusInfo.icon
                          const isSelected = selectedTask?.id === task.id

                          return (
                            <button
                              key={task.id}
                              onClick={() => setSelectedTask(task)}
                              className={`w-full text-left pl-10 pr-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 ${
                                isSelected ? 'bg-amber-50' : ''
                              }`}
                            >
                              <StatusIcon
                                className={`w-5 h-5 ${statusInfo.color} shrink-0`}
                                weight={task.status === 'done' ? 'fill' : 'regular'}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-medium truncate ${
                                    task.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-900'
                                  }`}>
                                    {task.title}
                                  </span>
                                  {task.type === 'spec' && (
                                    <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded shrink-0">
                                      仕様
                                    </span>
                                  )}
                                  {task.ball === 'client' && task.status !== 'done' && (
                                    <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded shrink-0">
                                      要対応
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                                  <span className={statusInfo.color}>{statusInfo.label}</span>
                                  {task.dueDate && (
                                    <span>期限: {formatDate(task.dueDate)}</span>
                                  )}
                                </div>
                              </div>
                              <CaretRight className="w-4 h-4 text-gray-400 shrink-0" />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
