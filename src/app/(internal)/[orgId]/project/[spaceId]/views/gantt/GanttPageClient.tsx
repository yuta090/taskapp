'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { SquaresFour, Spinner } from '@phosphor-icons/react'
import { Breadcrumb } from '@/components/shared'
import { GanttChart } from '@/components/gantt'
import { useInspector } from '@/components/layout'
import { TaskInspector } from '@/components/task/TaskInspector'
import { useTasks } from '@/lib/hooks/useTasks'
import { useMilestones } from '@/lib/hooks/useMilestones'
import type { BallSide, TaskStatus } from '@/types/database'

interface GanttPageClientProps {
  orgId: string
  spaceId: string
}

export function GanttPageClient({ orgId, spaceId }: GanttPageClientProps) {
  const searchParams = useSearchParams()
  const selectedTaskId = searchParams.get('task') || undefined
  const { setInspector } = useInspector()

  const { tasks, owners, loading: tasksLoading, error: tasksError, fetchTasks, updateTask, deleteTask, passBall } = useTasks({
    orgId,
    spaceId,
  })

  const {
    milestones,
    loading: milestonesLoading,
    error: milestonesError,
    fetchMilestones,
  } = useMilestones({ spaceId })

  const [initialized, setInitialized] = useState(false)
  const [updateLog, setUpdateLog] = useState<Array<{
    id: string
    taskId: string
    taskTitle: string
    field: 'start' | 'end'
    oldValue: string | null
    newValue: string
    timestamp: Date
  }>>([])

  const projectBasePath = `/${orgId}/project/${spaceId}/views/gantt`

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchTasks(), fetchMilestones()])
      setInitialized(true)
    }
    init()
  }, [fetchTasks, fetchMilestones])

  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  // Find selected task
  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null
    return tasks.find((task) => task.id === selectedTaskId) ?? null
  }, [tasks, selectedTaskId])

  // Sync URL with state
  const syncUrlWithState = useCallback(
    (taskId: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (taskId) {
        params.set('task', taskId)
      } else {
        params.delete('task')
      }
      const query = params.toString()
      const newUrl = query ? `${projectBasePath}?${query}` : projectBasePath
      window.history.replaceState(null, '', newUrl)
    },
    [projectBasePath, searchParams]
  )

  // Pass ball handler
  const handlePassBall = useCallback(
    async (taskId: string, ball: BallSide) => {
      const taskOwners = owners[taskId] || []
      const clientOwnerIds = taskOwners
        .filter((owner) => owner.side === 'client')
        .map((owner) => owner.user_id)
      const internalOwnerIds = taskOwners
        .filter((owner) => owner.side === 'internal')
        .map((owner) => owner.user_id)

      if (ball === 'client' && clientOwnerIds.length === 0) {
        alert('クライアント担当者を指定してください')
        return
      }

      await passBall(taskId, ball, clientOwnerIds, internalOwnerIds)
    },
    [owners, passBall]
  )

  // Update task handler
  const handleUpdateTask = useCallback(
    async (taskId: string, updates: {
      title?: string
      description?: string | null
      status?: TaskStatus
      dueDate?: string | null
      milestoneId?: string | null
      assigneeId?: string | null
    }) => {
      await updateTask(taskId, updates)
    },
    [updateTask]
  )

  // Update owners handler
  const handleUpdateOwners = useCallback(
    async (taskId: string, clientOwnerIds: string[], internalOwnerIds: string[]) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      await passBall(taskId, task.ball, clientOwnerIds, internalOwnerIds)
    },
    [tasks, passBall]
  )

  // Delete task handler
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await deleteTask(taskId)
      syncUrlWithState(null)
    },
    [deleteTask, syncUrlWithState]
  )

  // Set inspector when task is selected
  useEffect(() => {
    if (!selectedTask) {
      setInspector(null)
      return
    }

    setInspector(
      <TaskInspector
        task={selectedTask}
        spaceId={spaceId}
        owners={owners[selectedTask.id] || []}
        onClose={() => {
          syncUrlWithState(null)
        }}
        onPassBall={(ball) => handlePassBall(selectedTask.id, ball)}
        onUpdate={(updates) => handleUpdateTask(selectedTask.id, updates)}
        onDelete={() => handleDeleteTask(selectedTask.id)}
        onUpdateOwners={(clientOwnerIds, internalOwnerIds) =>
          handleUpdateOwners(selectedTask.id, clientOwnerIds, internalOwnerIds)
        }
      />
    )
  }, [handlePassBall, handleUpdateTask, handleDeleteTask, handleUpdateOwners, owners, selectedTask, setInspector, syncUrlWithState, spaceId])

  const handleTaskClick = (taskId: string) => {
    // Toggle: clicking same task closes inspector
    const newTaskId = taskId === selectedTaskId ? null : taskId
    syncUrlWithState(newTaskId)
  }

  const handleDateChange = useCallback(
    async (taskId: string, field: 'start' | 'end', newDate: string) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return

      const oldValue = field === 'end' ? task.due_date : task.created_at
      const fieldLabel = field === 'end' ? '期限日' : '開始日'

      // Add to log
      const logEntry = {
        id: crypto.randomUUID(),
        taskId,
        taskTitle: task.title,
        field,
        oldValue,
        newValue: newDate,
        timestamp: new Date(),
      }
      setUpdateLog((prev) => [logEntry, ...prev].slice(0, 50)) // Keep last 50 entries

      console.log(
        `[ガントチャート] ${fieldLabel}変更: "${task.title}" ${oldValue || '未設定'} → ${newDate}`
      )

      try {
        if (field === 'end') {
          // Update due_date
          await updateTask(taskId, { dueDate: newDate })
          console.log(`[ガントチャート] ${fieldLabel}を保存しました`)
        } else {
          // Start date - requires start_date column in DB
          // For now, log but don't save (would need DB migration)
          console.warn(
            `[ガントチャート] 開始日の保存には start_date カラムの追加が必要です`
          )
          // If start_date column exists, uncomment:
          // await updateTask(taskId, { startDate: newDate })
        }
      } catch (err) {
        console.error(`[ガントチャート] ${fieldLabel}の保存に失敗しました:`, err)
        // Remove failed log entry
        setUpdateLog((prev) => prev.filter((e) => e.id !== logEntry.id))
      }
    },
    [tasks, updateTask]
  )

  const loading = !initialized || tasksLoading || milestonesLoading
  const error = tasksError || milestonesError

  const projectListPath = `/${orgId}/project/${spaceId}`

  const breadcrumbItems = [
    { label: 'Webリニューアル', href: projectListPath },
    { label: 'ガントチャート' },
  ]

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <SquaresFour className="text-lg text-gray-500" />
          <Breadcrumb items={breadcrumbItems} />
        </div>

        {/* Update log indicator */}
        {updateLog.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500">
              最終更新: {updateLog[0].taskTitle.slice(0, 15)}
              {updateLog[0].taskTitle.length > 15 ? '...' : ''} の
              {updateLog[0].field === 'end' ? '期限' : '開始'}日
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-slate-500">
              <Spinner className="w-5 h-5 animate-spin" />
              <span className="text-sm">読み込み中...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-red-600 mb-2">エラーが発生しました</p>
              <p className="text-xs text-slate-500">{error.message}</p>
              <button
                onClick={() => {
                  fetchTasks()
                  fetchMilestones()
                }}
                className="mt-4 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
              >
                再試行
              </button>
            </div>
          </div>
        ) : (
          <GanttChart
            tasks={tasks}
            milestones={milestones}
            selectedTaskId={selectedTaskId}
            onTaskClick={handleTaskClick}
            onDateChange={handleDateChange}
          />
        )}
      </div>
    </div>
  )
}
