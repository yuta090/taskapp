'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Target, Folder, CaretDown, CaretRight, FunnelSimple, SortAscending, SortDescending, X, Plus } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { TaskRow } from '@/components/task/TaskRow'
import type { Task, Space, Milestone, TaskStatus } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskCreateData } from '@/components/task/TaskCreateSheet'

const TaskCreateSheet = dynamic(
  () => import('@/components/task/TaskCreateSheet').then((m) => ({ default: m.TaskCreateSheet })),
  { ssr: false }
)

// Development mode fallback user ID
const DEV_USER_ID = '0124bcca-7c66-406c-b1ae-2be8dac241c5'
const STORAGE_KEY = 'my-tasks-collapsed-milestones'
const FILTER_STORAGE_KEY = 'my-tasks-filters'

type SortField = 'due_date' | 'created_at' | 'priority' | 'title'
type SortOrder = 'asc' | 'desc'
type StatusFilter = 'all' | 'todo' | 'in_progress' | 'in_review'

interface FilterState {
  status: StatusFilter
  spaceId: string | null
  showCompleted: boolean
  sortField: SortField
  sortOrder: SortOrder
}

const defaultFilters: FilterState = {
  status: 'all',
  spaceId: null,
  showCompleted: false,
  sortField: 'due_date',
  sortOrder: 'asc',
}

interface TaskGroup {
  space: Space | null
  milestoneGroups: {
    milestone: Milestone | null
    tasks: Task[]
  }[]
}

function loadCollapsedState(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return new Set(JSON.parse(stored))
    }
  } catch {
    // ignore
  }
  return new Set()
}

function saveCollapsedState(collapsed: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(collapsed)))
  } catch {
    // ignore
  }
}

function loadFilterState(): FilterState {
  if (typeof window === 'undefined') return defaultFilters
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY)
    if (stored) {
      return { ...defaultFilters, ...JSON.parse(stored) }
    }
  } catch {
    // ignore
  }
  return defaultFilters
}

function saveFilterState(filters: FilterState) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // ignore
  }
}

const statusLabels: Record<StatusFilter, string> = {
  all: 'すべて',
  todo: 'TODO',
  in_progress: '進行中',
  in_review: '承認確認中',
}

const sortLabels: Record<SortField, string> = {
  due_date: '期限',
  created_at: '作成日',
  priority: '優先度',
  title: 'タイトル',
}

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [spaces, setSpaces] = useState<Space[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [collapsedMilestones, setCollapsedMilestones] = useState<Set<string>>(() => loadCollapsedState())
  const [filters, setFilters] = useState<FilterState>(() => loadFilterState())
  const [showFilters, setShowFilters] = useState(false)

  const searchParams = useSearchParams()
  const router = useRouter()
  const isCreateOpen = searchParams.get('create') !== null
  const supabase = useMemo(() => createClient(), [])

  // Space options for global create
  const spaceOptions = useMemo(
    () => spaces.map((s) => ({ id: s.id, name: s.name, orgId: (s as Record<string, string>).org_id || '' })),
    [spaces]
  )

  const handleCreateOpen = useCallback(() => {
    router.push('/my?create=1')
  }, [router])

  const handleCreateClose = useCallback(() => {
    router.push('/my')
  }, [router])

  const handleCreateSubmit = useCallback(
    async (data: TaskCreateData & { spaceId?: string; orgId?: string }) => {
      const targetSpaceId = data.spaceId
      if (!targetSpaceId) return

      // Validate against known spaces to prevent mismatched spaceId/orgId
      const targetSpace = spaces.find((s) => s.id === targetSpaceId)
      if (!targetSpace) return
      const targetOrgId = (targetSpace as Record<string, string>).org_id || ''
      if (!targetOrgId) return

      try {
        // Get authenticated user
        let uid: string
        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (authError || !authData?.user) {
          const demoUserId = process.env.NEXT_PUBLIC_DEMO_USER_ID
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && demoUserId) {
            uid = demoUserId
          } else {
            throw new Error('ログインが必要です')
          }
        } else {
          uid = authData.user.id
        }

        const status = data.type === 'spec' ? 'considering' : 'backlog'

        const { data: created, error: createError } = await (supabase as SupabaseClient)
          .from('tasks')
          .insert({
            org_id: targetOrgId,
            space_id: targetSpaceId,
            title: data.title,
            description: data.description ?? '',
            status,
            ball: data.ball,
            origin: data.origin,
            type: data.type,
            spec_path: data.type === 'spec' ? data.specPath ?? null : null,
            decision_state: data.type === 'spec' ? data.decisionState ?? null : null,
            client_scope: data.clientScope ?? 'internal',
            due_date: data.dueDate ?? null,
            assignee_id: data.assigneeId ?? null,
            milestone_id: data.milestoneId ?? null,
            parent_task_id: data.parentTaskId ?? null,
            created_by: uid,
          } as Record<string, unknown>)
          .select('*')
          .single()

        if (createError) throw createError

        const createdTask = created as Task

        // Insert task owners
        const ownerRows = [
          ...data.clientOwnerIds.map((ownerId) => ({
            org_id: targetOrgId,
            space_id: targetSpaceId,
            task_id: createdTask.id,
            side: 'client' as const,
            user_id: ownerId,
          })),
          ...data.internalOwnerIds.map((ownerId) => ({
            org_id: targetOrgId,
            space_id: targetSpaceId,
            task_id: createdTask.id,
            side: 'internal' as const,
            user_id: ownerId,
          })),
        ]

        if (ownerRows.length > 0) {
          const { error: ownerError } = await (supabase as SupabaseClient)
            .from('task_owners')
            .insert(ownerRows as Record<string, unknown>[])
          if (ownerError) {
            console.error('Failed to insert task owners:', ownerError)
            // Task created but owners failed - still add to list but warn
          }
        }

        // If the created task is assigned to the current user, add to the list
        if (createdTask.assignee_id === userId || createdTask.assignee_id === DEV_USER_ID) {
          setTasks((prev) => [createdTask, ...prev])
        }
      } catch (err) {
        console.error('Failed to create task:', err)
        alert('タスクの作成に失敗しました')
      }
    },
    [supabase, userId, spaces]
  )

  const updateFilters = useCallback((updates: Partial<FilterState>) => {
    setFilters(prev => {
      const next = { ...prev, ...updates }
      saveFilterState(next)
      return next
    })
  }, [])

  const toggleMilestone = useCallback((milestoneKey: string) => {
    setCollapsedMilestones(prev => {
      const next = new Set(prev)
      if (next.has(milestoneKey)) {
        next.delete(milestoneKey)
      } else {
        next.add(milestoneKey)
      }
      saveCollapsedState(next)
      return next
    })
  }, [])

  const updateTaskStatus = useCallback(async (taskId: string, status: TaskStatus) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t))

    const { error } = await (supabase as SupabaseClient)
      .from('tasks')
      .update({ status })
      .eq('id', taskId)

    if (error) {
      // Revert on error
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: tasks.find(task => task.id === taskId)?.status || t.status } : t))
      console.error('Failed to update task status:', error)
    }
  }, [supabase, tasks])

  useEffect(() => {
    async function fetchData(uid: string) {
      setUserId(uid)

      const [tasksRes, spacesRes, milestonesRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('*')
          .eq('assignee_id', uid),
        supabase
          .from('spaces')
          .select('*'),
        supabase
          .from('milestones')
          .select('*')
          .order('due_date', { ascending: true, nullsFirst: false })
      ])

      if (tasksRes.error) {
        setError(new Error('タスクの取得に失敗しました'))
      } else {
        setTasks(tasksRes.data || [])
        setSpaces(spacesRes.data || [])
        setMilestones(milestonesRes.data || [])
      }
      setLoading(false)
    }

    async function initAuth() {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        await fetchData(user.id)
      } else {
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          console.log('[MyTasks] Development mode: using demo user')
          await fetchData(DEV_USER_ID)
        } else {
          setError(new Error('ログインが必要です'))
          setLoading(false)
        }
      }
    }

    initAuth()
  }, [supabase])

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = [...tasks]

    // Status filter
    if (filters.status !== 'all') {
      result = result.filter(t => t.status === filters.status)
    } else if (!filters.showCompleted) {
      result = result.filter(t => t.status !== 'done' && t.status !== 'backlog')
    }

    // Space filter
    if (filters.spaceId) {
      result = result.filter(t => t.space_id === filters.spaceId)
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0
      switch (filters.sortField) {
        case 'due_date':
          const aDate = a.due_date || '9999-12-31'
          const bDate = b.due_date || '9999-12-31'
          comparison = aDate.localeCompare(bDate)
          break
        case 'created_at':
          comparison = a.created_at.localeCompare(b.created_at)
          break
        case 'priority':
          comparison = (a.priority || 0) - (b.priority || 0)
          break
        case 'title':
          comparison = a.title.localeCompare(b.title)
          break
      }
      return filters.sortOrder === 'asc' ? comparison : -comparison
    })

    return result
  }, [tasks, filters])

  // Group tasks by space, then by milestone
  const taskGroups = useMemo(() => {
    const activeTasks = filteredTasks.filter(t => t.status !== 'done' && t.status !== 'backlog')

    const spaceMap = new Map<string, Task[]>()
    activeTasks.forEach(task => {
      const spaceId = task.space_id || 'no-space'
      if (!spaceMap.has(spaceId)) {
        spaceMap.set(spaceId, [])
      }
      spaceMap.get(spaceId)!.push(task)
    })

    const groups: TaskGroup[] = []

    spaceMap.forEach((spaceTasks, spaceId) => {
      const space = spaces.find(s => s.id === spaceId) || null

      const milestoneMap = new Map<string, Task[]>()
      spaceTasks.forEach(task => {
        const milestoneId = task.milestone_id || 'no-milestone'
        if (!milestoneMap.has(milestoneId)) {
          milestoneMap.set(milestoneId, [])
        }
        milestoneMap.get(milestoneId)!.push(task)
      })

      const milestoneGroups = Array.from(milestoneMap.entries()).map(([milestoneId, mTasks]) => ({
        milestone: milestones.find(m => m.id === milestoneId) || null,
        tasks: mTasks
      }))

      milestoneGroups.sort((a, b) => {
        if (!a.milestone && !b.milestone) return 0
        if (!a.milestone) return 1
        if (!b.milestone) return -1
        const aDate = a.milestone.due_date || ''
        const bDate = b.milestone.due_date || ''
        return aDate.localeCompare(bDate)
      })

      groups.push({ space, milestoneGroups })
    })

    groups.sort((a, b) => {
      const aName = a.space?.name || ''
      const bName = b.space?.name || ''
      return aName.localeCompare(bName)
    })

    return groups
  }, [filteredTasks, spaces, milestones])

  const completedTasks = filteredTasks.filter(t => t.status === 'done')
  const activeTasks = filteredTasks.filter(t => t.status !== 'done' && t.status !== 'backlog')

  const hasActiveFilters = filters.status !== 'all' || filters.spaceId !== null || filters.showCompleted

  function formatDate(dateStr: string | null): string | null {
    if (!dateStr) return null
    const date = new Date(dateStr)
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}/${day}`
  }

  function getMilestoneKey(spaceId: string | undefined, milestoneId: string | undefined): string {
    return `${spaceId || 'no-space'}:${milestoneId || 'no-milestone'}`
  }

  function resetFilters() {
    updateFilters(defaultFilters)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Target className="text-lg text-gray-500" />
          マイタスク
        </h1>
        <span className="ml-2 text-xs text-gray-400">
          {activeTasks.length}件
        </span>

        <div className="flex-1" />

        {/* Create button */}
        <button
          onClick={handleCreateOpen}
          data-testid="my-tasks-create"
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors mr-1"
          title="新規タスク"
        >
          <Plus weight="bold" className="text-sm" />
          作成
        </button>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-colors ${
            showFilters || hasActiveFilters
              ? 'bg-blue-50 text-blue-600'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          <FunnelSimple weight={hasActiveFilters ? 'fill' : 'regular'} className="text-sm" />
          フィルター
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
          )}
        </button>

        {/* Sort button */}
        <button
          onClick={() => updateFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors ml-1"
        >
          {filters.sortOrder === 'asc' ? (
            <SortAscending className="text-sm" />
          ) : (
            <SortDescending className="text-sm" />
          )}
          {sortLabels[filters.sortField]}
        </button>
      </header>

      {/* Filter bar */}
      {showFilters && (
        <div className="border-b border-gray-100 px-5 py-3 bg-gray-50/50 flex items-center gap-4 flex-wrap">
          {/* Status filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">ステータス:</span>
            <select
              value={filters.status}
              onChange={(e) => updateFilters({ status: e.target.value as StatusFilter })}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Space filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">プロジェクト:</span>
            <select
              value={filters.spaceId || ''}
              onChange={(e) => updateFilters({ spaceId: e.target.value || null })}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">すべて</option>
              {spaces.map(space => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
          </div>

          {/* Sort field */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">並び替え:</span>
            <select
              value={filters.sortField}
              onChange={(e) => updateFilters({ sortField: e.target.value as SortField })}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Show completed toggle */}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.showCompleted}
              onChange={(e) => updateFilters({ showCompleted: e.target.checked })}
              className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            完了を表示
          </label>

          {/* Reset button */}
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 ml-auto"
            >
              <X className="text-sm" />
              リセット
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-4">
          {loading && (
            <div className="text-center text-gray-400 py-16">読み込み中...</div>
          )}
          {error && (
            <div className="text-center text-red-500 py-16">
              {error.message}
            </div>
          )}
          {!loading && !error && tasks.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <Target className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm">担当しているタスクはありません</p>
              {userId && (
                <p className="text-xs mt-1 text-gray-300">
                  User: {userId.slice(0, 8)}...
                </p>
              )}
            </div>
          )}
          {!loading && !error && tasks.length > 0 && filteredTasks.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <FunnelSimple className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm">条件に一致するタスクがありません</p>
              <button
                onClick={resetFilters}
                className="mt-3 text-xs text-blue-500 hover:underline"
              >
                フィルターをリセット
              </button>
            </div>
          )}
          {!loading && !error && filteredTasks.length > 0 && (
            <div className="space-y-6">
              {/* Active tasks grouped by project and milestone */}
              {taskGroups.map((group, groupIndex) => (
                <div key={group.space?.id || `no-space-${groupIndex}`}>
                  {/* Project header - Level 0 */}
                  <div className="flex items-center gap-1.5 px-2 py-2 bg-gray-100 rounded-sm">
                    <Folder weight="fill" className="text-gray-500 text-sm" />
                    <span className="text-[13px] font-bold text-gray-800">
                      {group.space?.name || 'プロジェクト未設定'}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {group.milestoneGroups.reduce((acc, mg) => acc + mg.tasks.length, 0)}件
                    </span>
                  </div>

                  {/* Milestone groups within project - Level 1 (indented) */}
                  <div className="space-y-3 py-2">
                    {group.milestoneGroups.map((mg, mgIndex) => {
                      const milestoneKey = getMilestoneKey(group.space?.id, mg.milestone?.id)
                      const isCollapsed = collapsedMilestones.has(milestoneKey)

                      return (
                        <div key={mg.milestone?.id || `no-milestone-${mgIndex}`}>
                          {/* Milestone header - slight indent */}
                          <div
                            className="flex items-center gap-1.5 pl-4 pr-2 py-1.5 bg-gray-50 rounded cursor-pointer hover:bg-gray-100 transition-colors select-none mx-2"
                            onClick={() => toggleMilestone(milestoneKey)}
                          >
                            <div className="w-3 flex justify-center text-gray-400">
                              {isCollapsed ? (
                                <CaretRight weight="bold" className="text-[10px]" />
                              ) : (
                                <CaretDown weight="bold" className="text-[10px]" />
                              )}
                            </div>
                            <span className="text-[13px] font-semibold text-gray-700">
                              {mg.milestone?.name || 'マイルストーン未設定'}
                            </span>
                            {mg.milestone?.due_date && (
                              <span className="text-xs text-gray-400 tabular-nums">
                                {formatDate(mg.milestone.due_date)}
                              </span>
                            )}
                            <span className="text-xs text-gray-400 tabular-nums">
                              ({mg.tasks.length})
                            </span>
                          </div>

                          {/* Tasks in this milestone - Level 2 */}
                          {!isCollapsed && (
                            <div className="pl-3 mt-1">
                              {mg.tasks.map((task) => (
                                <TaskRow
                                  key={task.id}
                                  task={task}
                                  onClick={() => {
                                    const orgId = task.org_id
                                    const spaceId = task.space_id
                                    window.location.href = `/${orgId}/project/${spaceId}?task=${task.id}`
                                  }}
                                  onStatusChange={updateTaskStatus}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* Completed tasks */}
              {filters.showCompleted && completedTasks.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-200">
                    <span className="text-xs font-semibold text-gray-400">
                      完了 ({completedTasks.length})
                    </span>
                  </div>
                  <div className="opacity-50">
                    {completedTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onClick={() => {
                          const orgId = task.org_id
                          const spaceId = task.space_id
                          window.location.href = `/${orgId}/project/${spaceId}?task=${task.id}`
                        }}
                        onStatusChange={updateTaskStatus}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Task Create Sheet (global create with space selector) */}
      <TaskCreateSheet
        spaceId=""
        isOpen={isCreateOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        spaces={spaceOptions}
      />
    </div>
  )
}
