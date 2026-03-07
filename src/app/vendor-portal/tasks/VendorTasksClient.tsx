'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { VendorPortalShell } from '@/components/vendor-portal'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { getBallStatusLabel } from '@/lib/agency/labels'

interface Task {
  id: string
  title: string
  status: string
  ball: string
  due_date: string | null
  milestone_id: string | null
  priority: number | null
  created_at: string
  updated_at: string
}

interface VendorTasksClientProps {
  spaceId: string
  spaceName: string
  orgId: string
  tasks: Task[]
}

const STATUS_LABELS: Record<string, string> = {
  backlog: 'バックログ',
  todo: 'Todo',
  in_progress: '進行中',
  in_review: 'レビュー中',
  done: '完了',
  considering: '検討中',
}

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-600',
  todo: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-indigo-50 text-indigo-700',
  in_review: 'bg-amber-50 text-amber-700',
  done: 'bg-emerald-50 text-emerald-700',
  considering: 'bg-purple-50 text-purple-700',
}

const BALL_COLORS: Record<string, string> = {
  vendor: 'bg-indigo-500 text-white',
  agency: 'bg-amber-100 text-amber-700',
  internal: 'bg-amber-100 text-amber-700',
  client: 'bg-gray-100 text-gray-600',
}

type FilterType = 'all' | 'vendor' | 'agency'

export function VendorTasksClient({
  spaceId,
  spaceName,
  orgId,
  tasks: initialTasks,
}: VendorTasksClientProps) {
  const [tasks, setTasks] = useState(initialTasks)
  const [filter, setFilter] = useState<FilterType>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const filteredTasks = useMemo(() => {
    if (filter === 'all') return tasks
    if (filter === 'vendor') return tasks.filter((t) => t.ball === 'vendor')
    if (filter === 'agency') return tasks.filter((t) => t.ball === 'agency' || t.ball === 'internal')
    return tasks
  }, [tasks, filter])

  const vendorCount = useMemo(() => tasks.filter((t) => t.ball === 'vendor').length, [tasks])
  const agencyCount = useMemo(
    () => tasks.filter((t) => t.ball === 'agency' || t.ball === 'internal').length,
    [tasks]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: string) => {
      const prev = tasks.find((t) => t.id === taskId)
      if (!prev) return

      // Optimistic update
      setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)))

      const { error } = await (supabase as SupabaseClient)
        .from('tasks')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', taskId)

      if (error) {
        setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status: prev.status } : t)))
        toast.error('ステータスの更新に失敗しました')
      } else {
        toast.success('ステータスを更新しました')
      }
    },
    [tasks, supabase]
  )

  return (
    <VendorPortalShell
      currentProject={{ id: spaceId, name: spaceName, orgId }}
      actionCount={vendorCount}
    >
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900">タスク一覧</h1>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              全て ({tasks.length})
            </button>
            <button
              onClick={() => setFilter('vendor')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === 'vendor' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              自社 ({vendorCount})
            </button>
            <button
              onClick={() => setFilter('agency')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === 'agency' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              代理店 ({agencyCount})
            </button>
          </div>
        </div>

        {/* Task list */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {filteredTasks.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-500">
              {filter === 'all' ? 'タスクがありません' : '該当するタスクがありません'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => setSelectedTaskId(selectedTaskId === task.id ? null : task.id)}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                    selectedTaskId === task.id ? 'bg-indigo-50/50' : ''
                  }`}
                >
                  {/* Ball badge */}
                  <span
                    className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full ${
                      BALL_COLORS[task.ball] || 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {getBallStatusLabel(task.ball as 'client' | 'internal' | 'agency' | 'vendor', true)}
                  </span>

                  {/* Title */}
                  <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">
                    {task.title}
                  </span>

                  {/* Due date */}
                  {task.due_date && (
                    <span className="flex-shrink-0 text-xs text-gray-400">
                      {new Date(task.due_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                    </span>
                  )}

                  {/* Status select */}
                  <select
                    value={task.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleStatusChange(task.id, e.target.value)}
                    className={`flex-shrink-0 px-2 py-1 text-xs rounded-md border-0 cursor-pointer focus:ring-1 focus:ring-indigo-300 ${
                      STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <option value="backlog">{STATUS_LABELS.backlog}</option>
                    <option value="todo">{STATUS_LABELS.todo}</option>
                    <option value="in_progress">{STATUS_LABELS.in_progress}</option>
                    <option value="in_review">{STATUS_LABELS.in_review}</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </VendorPortalShell>
  )
}
