'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Copy, GearSix, ChatCircleText, SortAscending, CaretDown, X } from '@phosphor-icons/react'
import Link from 'next/link'
import { Breadcrumb } from '@/components/shared'
import { useInspector } from '@/components/layout'
import { TaskRow } from '@/components/task/TaskRow'
import type { TaskCreateData } from '@/components/task/TaskCreateSheet'

const TaskInspector = dynamic(() => import('@/components/task/TaskInspector').then(mod => ({ default: mod.TaskInspector })), { ssr: false })
const TaskCreateSheet = dynamic(() => import('@/components/task/TaskCreateSheet').then(mod => ({ default: mod.TaskCreateSheet })), { ssr: false })
import { MilestoneGroupHeader } from '@/components/task/MilestoneGroupHeader'
import { TaskFilterMenu, TaskFilters, defaultFilters, applyTaskFilters } from '@/components/task/TaskFilterMenu'
import { useTasks } from '@/lib/hooks/useTasks'
import { useMilestones } from '@/lib/hooks/useMilestones'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { getEligibleParents } from '@/lib/gantt/treeUtils'
import type { BallSide, Task, TaskStatus, Milestone, DecisionState } from '@/types/database'

interface TasksPageClientProps {
  orgId: string
  spaceId: string
}

type FilterKey = 'all' | 'active' | 'backlog' | 'client_wait'
type SortKey = 'milestone' | 'due_date' | 'created_at'

interface TaskGroup {
  milestone: Milestone | null
  tasks: Task[]
}

export function TasksPageClient({ orgId, spaceId }: TasksPageClientProps) {
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const { tasks, owners, loading, error, fetchTasks, createTask, updateTask, deleteTask, passBall } =
    useTasks({ orgId, spaceId })
  const { milestones, fetchMilestones } = useMilestones({ spaceId })
  const { getMemberName } = useSpaceMembers(spaceId)

  const [sortKey, setSortKey] = useState<SortKey>('milestone')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<TaskFilters>(defaultFilters)
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, 'open' | 'approved' | 'changes_requested'>>({})
  // Carry-over state for consecutive task creates (UX rule: ball/owners persist per space)
  const [lastBallBySpace, setLastBallBySpace] = useState<Record<string, BallSide>>({})
  const [lastClientOwnersBySpace, setLastClientOwnersBySpace] = useState<Record<string, string[]>>({})
  const lastBall = lastBallBySpace[spaceId] ?? 'internal'
  const lastClientOwnerIds = lastClientOwnersBySpace[spaceId] ?? []
  const [spaceName, setSpaceName] = useState<string>('')

  const projectBasePath = `/${orgId}/project/${spaceId}`

  // Eligible parent tasks for subtask creation
  const parentTaskOptions = useMemo(
    () => getEligibleParents(tasks).map((t) => ({ id: t.id, title: t.title })),
    [tasks]
  )

  // Create unique owners list for filter (with display names from profiles)
  const uniqueOwners = useMemo(() => {
    const ownerMap = new Map<string, { user_id: string; display_name: string | null; side: 'client' | 'internal' }>()
    Object.values(owners).forEach((taskOwners) => {
      taskOwners.forEach((owner) => {
        if (!ownerMap.has(owner.user_id)) {
          ownerMap.set(owner.user_id, {
            user_id: owner.user_id,
            display_name: getMemberName(owner.user_id),
            side: owner.side,
          })
        }
      })
    })
    return Array.from(ownerMap.values())
  }, [owners, getMemberName])

  // Derive UI state directly from URL params (no sync needed)
  const isCreateOpen = searchParams.get('create') !== null
  const selectedTaskId = searchParams.get('task')
  const activeFilter: FilterKey = useMemo(() => {
    const filterParam = searchParams.get('filter')
    if (filterParam === 'all' || filterParam === 'active' || filterParam === 'backlog' || filterParam === 'client_wait') {
      return filterParam
    }
    return 'active'
  }, [searchParams])

  // Fetch review statuses for badge display
  const fetchReviewStatuses = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('reviews')
        .select('task_id, status')
        .eq('space_id' as never, spaceId as never)
      if (data) {
        const map: Record<string, 'open' | 'approved' | 'changes_requested'> = {}
        data.forEach((r: { task_id: string; status: string }) => {
          map[r.task_id] = r.status as 'open' | 'approved' | 'changes_requested'
        })
        setReviewStatuses(map)
      }
    } catch {
      // Silently fail - review badges are non-critical
    }
  }, [spaceId])

  // Optimistic update for review status badge (called from TaskReviewSection via TaskInspector)
  const handleReviewChange = useCallback((taskId: string, status: string | null) => {
    setReviewStatuses((prev) => {
      if (!status) {
        const next = { ...prev }
        delete next[taskId]
        return next
      }
      return { ...prev, [taskId]: status as 'open' | 'approved' | 'changes_requested' }
    })
  }, [])

  useEffect(() => {
    void fetchTasks()
    void fetchMilestones()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch stores results in state
    void fetchReviewStatuses()
  }, [fetchTasks, fetchMilestones, fetchReviewStatuses])

  // Fetch space name with race condition + unmount guard
  useEffect(() => {
    let active = true
    setSpaceName('') // eslint-disable-line react-hooks/set-state-in-effect -- reset before async fetch
    void (async () => {
      const supabase = createClient()
      const { data } = await supabase.from('spaces').select('name').eq('id' as never, spaceId as never).single()
      if (active && data) setSpaceName((data as Record<string, string>).name)
    })()
    return () => { active = false }
  }, [spaceId])

  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  // Update URL based on state changes
  const syncUrlWithState = useCallback(
    (
      create: boolean,
      task: string | null,
      filter: FilterKey
    ) => {
      const params = new URLSearchParams()
      if (create) {
        params.set('create', '1')
      }
      if (task) {
        params.set('task', task)
      }
      if (filter !== 'all') {
        params.set('filter', filter)
      }
      const query = params.toString()
      const newUrl = query ? `${projectBasePath}?${query}` : projectBasePath
      window.history.replaceState(null, '', newUrl)
    },
    [projectBasePath]
  )

  // Check if advanced filters are active
  const hasAdvancedFilters = useMemo(() => {
    return (
      advancedFilters.status.length > 0 ||
      advancedFilters.ball.length > 0 ||
      advancedFilters.type.length > 0 ||
      advancedFilters.assigneeId.length > 0 ||
      advancedFilters.milestoneId.length > 0 ||
      advancedFilters.priority.length > 0 ||
      advancedFilters.dueDateRange !== 'all' ||
      advancedFilters.decisionState.length > 0
    )
  }, [advancedFilters])

  const filteredTasks = useMemo(() => {
    let result: Task[]

    // First apply quick filters (tabs)
    switch (activeFilter) {
      case 'active':
        result = tasks.filter(
          (task) => task.status !== 'backlog' && task.status !== 'done'
        )
        break
      case 'backlog':
        result = tasks.filter((task) => task.status === 'backlog')
        break
      case 'client_wait':
        result = tasks.filter((task) => task.ball === 'client')
        break
      default:
        result = tasks
    }

    // Then apply advanced filters
    if (hasAdvancedFilters) {
      result = applyTaskFilters(result, advancedFilters)
    }

    return result
  }, [tasks, activeFilter, advancedFilters, hasAdvancedFilters])

  // Group and sort tasks
  const taskGroups: TaskGroup[] = useMemo(() => {
    if (sortKey !== 'milestone') {
      // Flat list sorted by due_date or created_at
      const sorted = [...filteredTasks].sort((a, b) => {
        if (sortKey === 'due_date') {
          // Tasks without due_date go to the end
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        }
        // created_at
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      return [{ milestone: null, tasks: sorted }]
    }

    // Group by milestone
    const groups: TaskGroup[] = []
    const tasksByMilestone = new Map<string | null, Task[]>()

    filteredTasks.forEach((task) => {
      const key = task.milestone_id || null
      if (!tasksByMilestone.has(key)) {
        tasksByMilestone.set(key, [])
      }
      tasksByMilestone.get(key)!.push(task)
    })

    // Sort tasks within each group by due_date
    tasksByMilestone.forEach((groupTasks) => {
      groupTasks.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      })
    })

    // Sort milestones by order_key
    const sortedMilestones = [...milestones].sort((a, b) => a.order_key - b.order_key)

    // Add milestone groups
    sortedMilestones.forEach((milestone) => {
      const groupTasks = tasksByMilestone.get(milestone.id) || []
      if (groupTasks.length > 0) {
        groups.push({ milestone, tasks: groupTasks })
      }
    })

    // Add tasks without milestone
    const noMilestoneTasks = tasksByMilestone.get(null) || []
    if (noMilestoneTasks.length > 0) {
      groups.push({ milestone: null, tasks: noMilestoneTasks })
    }

    return groups
  }, [filteredTasks, milestones, sortKey])

  const selectedTask: Task | null = useMemo(() => {
    if (!selectedTaskId) return null
    return tasks.find((task) => task.id === selectedTaskId) ?? null
  }, [tasks, selectedTaskId])

  const handlePassBall = useCallback(
    async (taskId: string, ball: BallSide, overrideClientOwnerIds?: string[], overrideInternalOwnerIds?: string[]) => {
      const taskOwners = owners[taskId] || []
      const clientOwnerIds = overrideClientOwnerIds ?? taskOwners
        .filter((owner) => owner.side === 'client')
        .map((owner) => owner.user_id)
      const internalOwnerIds = overrideInternalOwnerIds ?? taskOwners
        .filter((owner) => owner.side === 'internal')
        .map((owner) => owner.user_id)

      // バリデーションはTaskInspector側で処理済み（フォールバック用のみ残す）
      if (ball === 'client' && clientOwnerIds.length === 0) {
        return
      }

      await passBall(taskId, ball, clientOwnerIds, internalOwnerIds)
    },
    [owners, passBall]
  )

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: {
      title?: string
      description?: string | null
      status?: TaskStatus
      startDate?: string | null
      dueDate?: string | null
      milestoneId?: string | null
      assigneeId?: string | null
      actualHours?: number | null
    }) => {
      await updateTask(taskId, updates)
    },
    [updateTask]
  )

  const handleUpdateOwners = useCallback(
    async (taskId: string, clientOwnerIds: string[], internalOwnerIds: string[]) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      // Use passBall with current ball value to just update owners
      await passBall(taskId, task.ball, clientOwnerIds, internalOwnerIds)
    },
    [tasks, passBall]
  )

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await deleteTask(taskId)
      syncUrlWithState(isCreateOpen, null, activeFilter)
    },
    [deleteTask, syncUrlWithState, isCreateOpen, activeFilter]
  )

  // AT-009: Spec task state transition
  const handleSetSpecState = useCallback(
    async (taskId: string, decisionState: DecisionState) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) throw new Error('Task not found')

      // Validation: spec_path is required for decided/implemented
      if (decisionState !== 'considering' && !task.spec_path) {
        throw new Error('仕様ファイルパス（spec_path）が設定されていません')
      }

      const supabase = createClient()
      await rpc.setSpecState(supabase, {
        taskId,
        decisionState,
      })
      await fetchTasks()
    },
    [tasks, fetchTasks]
  )

  useEffect(() => {
    if (!selectedTask) {
      setInspector(null)
      return
    }

    const childTasks = tasks.filter((t) => t.parent_task_id === selectedTask.id)
    const parentTasks = getEligibleParents(tasks, selectedTask.id).map((t) => ({
      id: t.id,
      title: t.title,
    }))

    setInspector(
      <TaskInspector
        task={selectedTask}
        spaceId={spaceId}
        owners={owners[selectedTask.id] || []}
        parentTasks={parentTasks}
        childTasks={childTasks}
        onClose={() => {
          syncUrlWithState(isCreateOpen, null, activeFilter)
        }}
        onPassBall={(ball, clientOwnerIds, internalOwnerIds) => handlePassBall(selectedTask.id, ball, clientOwnerIds, internalOwnerIds)}
        onUpdate={(updates) => handleUpdateTask(selectedTask.id, updates)}
        onDelete={() => handleDeleteTask(selectedTask.id)}
        onUpdateOwners={(clientOwnerIds, internalOwnerIds) =>
          handleUpdateOwners(selectedTask.id, clientOwnerIds, internalOwnerIds)
        }
        onSetSpecState={
          selectedTask.type === 'spec'
            ? (decisionState) => handleSetSpecState(selectedTask.id, decisionState)
            : undefined
        }
        onReviewChange={handleReviewChange}
      />
    )
  }, [handlePassBall, handleUpdateTask, handleDeleteTask, handleUpdateOwners, handleSetSpecState, handleReviewChange, owners, selectedTask, setInspector, syncUrlWithState, isCreateOpen, activeFilter, spaceId, tasks])

  const handleFilterChange = useCallback((filter: FilterKey) => {
    syncUrlWithState(isCreateOpen, selectedTaskId, filter)
  }, [syncUrlWithState, isCreateOpen, selectedTaskId])

  const handleCreateClose = useCallback(() => {
    syncUrlWithState(false, selectedTaskId, activeFilter)
  }, [syncUrlWithState, selectedTaskId, activeFilter])

  // Stable refs for handleTaskSelect to keep callback identity stable across selection changes
  const selectedTaskIdRef = useRef(selectedTaskId)
  const syncUrlRef = useRef(syncUrlWithState)
  const isCreateOpenRef = useRef(isCreateOpen)
  const activeFilterRef = useRef(activeFilter)
  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId
    syncUrlRef.current = syncUrlWithState
    isCreateOpenRef.current = isCreateOpen
    activeFilterRef.current = activeFilter
  }, [selectedTaskId, syncUrlWithState, isCreateOpen, activeFilter])

  const handleTaskSelect = useCallback((taskId: string) => {
    // Toggle: clicking same task closes inspector
    const newTaskId = taskId === selectedTaskIdRef.current ? null : taskId
    syncUrlRef.current(isCreateOpenRef.current, newTaskId, activeFilterRef.current)
  }, [])

  const handleCreateSubmit = async (data: TaskCreateData) => {
    try {
      const created = await createTask({
        title: data.title,
        description: data.description,
        type: data.type,
        ball: data.ball,
        origin: data.origin,
        clientScope: data.clientScope,
        specPath: data.specPath,
        decisionState: data.decisionState,
        clientOwnerIds: data.clientOwnerIds,
        internalOwnerIds: data.internalOwnerIds,
        dueDate: data.dueDate,
        assigneeId: data.assigneeId,
        milestoneId: data.milestoneId,
        parentTaskId: data.parentTaskId,
      })
      // Persist ball/owners for next consecutive create (only on success, scoped to space)
      setLastBallBySpace((prev) => ({ ...prev, [spaceId]: data.ball }))
      setLastClientOwnersBySpace((prev) => ({ ...prev, [spaceId]: data.clientOwnerIds }))
      syncUrlWithState(false, created.id, activeFilter)
    } catch {
      alert('タスクの作成に失敗しました')
    }
  }

  const handleToggleGroup = useCallback((milestoneId: string | null) => {
    const key = milestoneId || '__none__'
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleStatusChange = useCallback((taskId: string, status: TaskStatus) => {
    updateTask(taskId, { status })
  }, [updateTask])

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'milestone', label: 'マイルストーン別' },
    { key: 'due_date', label: '期限日順' },
    { key: 'created_at', label: '作成日順' },
  ]

  const currentSortLabel = sortOptions.find((o) => o.key === sortKey)?.label || ''

  // Breadcrumb items
  const breadcrumbItems = [
    { label: spaceName || 'プロジェクト', href: projectBasePath },
    { label: activeFilter === 'client_wait' ? '確認待ち' : 'タスク' },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="border-b border-gray-100 flex-shrink-0">
        {/* Top row: Breadcrumb + Settings */}
        <div className="h-11 flex items-center px-5 border-b border-gray-50">
          <div className="flex items-center gap-2">
            {activeFilter === 'client_wait' ? (
              <ChatCircleText className="text-lg text-amber-500" />
            ) : (
              <Copy className="text-lg text-gray-500" />
            )}
            <Breadcrumb items={breadcrumbItems} />
          </div>
          <div className="flex-1" />
          <Link
            href={`${projectBasePath}/settings`}
            data-testid="project-settings-link"
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="プロジェクト設定"
          >
            <GearSix className="text-lg" />
          </Link>
        </div>

        {/* Bottom row: Filters + Sort */}
        <div className="h-10 flex items-center px-5 gap-4">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
            <button
              type="button"
              data-testid="tasks-filter-all"
              onClick={() => handleFilterChange('all')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                activeFilter === 'all'
                  ? 'text-gray-900 bg-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              すべて
            </button>
            <button
              type="button"
              data-testid="tasks-filter-active"
              onClick={() => handleFilterChange('active')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                activeFilter === 'active'
                  ? 'text-gray-900 bg-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              アクティブ
            </button>
            <button
              type="button"
              data-testid="tasks-filter-backlog"
              onClick={() => handleFilterChange('backlog')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                activeFilter === 'backlog'
                  ? 'text-gray-900 bg-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              未着手
            </button>
            <button
              type="button"
              data-testid="tasks-filter-client-wait"
              onClick={() => handleFilterChange('client_wait')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                activeFilter === 'client_wait'
                  ? 'text-amber-700 bg-amber-50 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              確認待ち
            </button>
          </div>

          {/* Advanced filter */}
          <TaskFilterMenu
            filters={advancedFilters}
            onFiltersChange={setAdvancedFilters}
            milestones={milestones}
            owners={uniqueOwners}
          />

          {/* Active filters display */}
          {hasAdvancedFilters && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAdvancedFilters(defaultFilters)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-500 transition-colors"
                title="フィルターをクリア"
              >
                <X className="text-sm" />
              </button>
            </div>
          )}

          {/* Divider */}
          <div className="h-4 w-px bg-gray-200" />

          {/* Sort dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors bg-white"
            >
              <SortAscending className="text-sm" />
              <span>{currentSortLabel}</span>
              <CaretDown className="text-[10px] text-gray-400" />
            </button>
            {showSortMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowSortMenu(false)}
                />
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 min-w-[140px]">
                  {sortOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setSortKey(option.key)
                        setShowSortMenu(false)
                      }}
                      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors ${
                        sortKey === option.key ? 'text-gray-900 font-medium' : 'text-gray-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="content-wrap py-4">
          {loading && (
            <div className="text-center text-gray-400 py-16">読み込み中...</div>
          )}
          {error && (
            <div className="text-center text-red-500 py-16">
              読み込みに失敗しました
            </div>
          )}
          {!loading && !error && filteredTasks.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <Copy className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm">タスクはありません</p>
              <p className="text-xs mt-1 text-gray-300">
                org: {orgId} / space: {spaceId}
              </p>
            </div>
          )}
          {!loading && !error && filteredTasks.length > 0 && (
            <div className="border-t border-gray-100">
              {taskGroups.map((group) => {
                const groupKey = group.milestone?.id || '__none__'
                const isCollapsed = collapsedGroups.has(groupKey)
                const showHeader = sortKey === 'milestone'

                return (
                  <div key={groupKey}>
                    {showHeader && (
                      <MilestoneGroupHeader
                        milestone={group.milestone}
                        taskCount={group.tasks.length}
                        isCollapsed={isCollapsed}
                        onToggle={() => handleToggleGroup(group.milestone?.id || null)}
                      />
                    )}
                    {!isCollapsed && group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        isSelected={task.id === selectedTaskId}
                        onClick={handleTaskSelect}
                        indent={showHeader}
                        onStatusChange={handleStatusChange}
                        reviewStatus={reviewStatuses[task.id]}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <TaskCreateSheet
        spaceId={spaceId}
        orgId={orgId}
        spaceName={spaceName}
        isOpen={isCreateOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        defaultBall={lastBall}
        defaultClientOwnerIds={lastClientOwnerIds}
        parentTasks={parentTaskOptions}
      />
    </div>
  )
}
