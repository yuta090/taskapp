'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { Copy, GearSix, ChatCircleText, SortAscending, CaretDown, MagnifyingGlass, X as XIcon, Circle, CheckCircle, ArrowRight, Plus, BookmarkSimple, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Breadcrumb, EmptyState, ErrorRetry, LoadingState } from '@/components/shared'
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts'
import { useInspector } from '@/components/layout'
import { TaskRow } from '@/components/task/TaskRow'
import type { TaskCreateData } from '@/components/task/TaskCreateSheet'

const TaskInspector = dynamic(() => import('@/components/task/TaskInspector').then(mod => ({ default: mod.TaskInspector })), {
  ssr: false,
  loading: () => <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div>,
})
const TaskCreateSheet = dynamic(() => import('@/components/task/TaskCreateSheet').then(mod => ({ default: mod.TaskCreateSheet })), {
  ssr: false,
  loading: () => <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div>,
})
import { MilestoneGroupHeader } from '@/components/task/MilestoneGroupHeader'
import { InternalOnboardingWalkthrough } from '@/components/onboarding/InternalOnboardingWalkthrough'
import { TaskFilterMenu, ActiveFilterChips, TaskFilters, defaultFilters, applyTaskFilters } from '@/components/task/TaskFilterMenu'
import { useTasks } from '@/lib/hooks/useTasks'
import { useMilestones } from '@/lib/hooks/useMilestones'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { getEligibleParents } from '@/lib/gantt/treeUtils'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { BallSide, Task, TaskStatus, Milestone, DecisionState } from '@/types/database'

interface TasksPageClientProps {
  orgId: string
  spaceId: string
}

type FilterKey = 'all' | 'active' | 'backlog' | 'client_wait'
type SortKey = 'milestone' | 'due_date' | 'created_at' | 'assignee' | 'status'

interface TaskGroup {
  milestone: Milestone | null
  tasks: Task[]
  label?: string
}

type VirtualRow =
  | { type: 'header'; group: TaskGroup; groupKey: string }
  | { type: 'task'; task: Task; indent: boolean }
  | { type: 'inline'; milestoneId: string | null; indent: boolean; groupKey: string }

const ROW_HEIGHT = 40

function InlineTaskInput({ indent, onSubmit }: { indent: boolean; onSubmit: (title: string) => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim())
      setValue('')
    }
    setIsEditing(false)
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => { setIsEditing(true); setTimeout(() => inputRef.current?.focus(), 0) }}
        className="w-full row-h flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        style={{ paddingLeft: indent ? 32 : 16, paddingRight: 16 }}
      >
        <Plus className="text-sm" />
        タスクを追加
      </button>
    )
  }

  return (
    <div
      className="row-h flex items-center gap-2"
      style={{ paddingLeft: indent ? 32 : 16, paddingRight: 16 }}
    >
      <Plus className="text-sm text-gray-400 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleSubmit() }
          if (e.key === 'Escape') { setValue(''); setIsEditing(false) }
        }}
        onBlur={handleSubmit}
        placeholder="タスク名を入力してEnter"
        className="flex-1 text-sm bg-transparent outline-none placeholder-gray-300"
      />
    </div>
  )
}

export function TasksPageClient({ orgId, spaceId }: TasksPageClientProps) {
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const { tasks, owners, reviewStatuses, loading, error, fetchTasks, createTask, updateTask, deleteTask, passBall, handleReviewChange } =
    useTasks({ orgId, spaceId })
  const { milestones } = useMilestones({ spaceId })
  const { getMemberName } = useSpaceMembers(spaceId)

  const [sortKey, setSortKey] = useState<SortKey>('milestone')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<TaskFilters>(defaultFilters)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [duplicateSource, setDuplicateSource] = useState<Task | null>(null)
  const [recentTaskIds, setRecentTaskIds] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null)
  // Carry-over state for consecutive task creates (UX rule: ball/owners persist per space)
  const [lastBallBySpace, setLastBallBySpace] = useState<Record<string, BallSide>>({})
  const [lastClientOwnersBySpace, setLastClientOwnersBySpace] = useState<Record<string, string[]>>({})
  const lastBall = lastBallBySpace[spaceId] ?? 'internal'
  const lastClientOwnerIds = lastClientOwnersBySpace[spaceId] ?? []

  // Supabase client for space name query
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const { data: spaceNameData } = useQuery<string>({
    queryKey: ['spaceName', spaceId],
    queryFn: async (): Promise<string> => {
      const { data } = await (supabaseRef.current! as SupabaseClient)
        .from('spaces')
        .select('name')
        .eq('id', spaceId)
        .single()
      return (data as { name: string } | null)?.name ?? ''
    },
    staleTime: 30_000,
    enabled: !!spaceId,
  })
  const spaceName = spaceNameData ?? ''

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
    return 'all'
  }, [searchParams])

  // useQuery auto-fetches tasks, milestones, and spaceName — no manual useEffect needed

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

    // Then apply search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (task) =>
          task.title.toLowerCase().includes(q) ||
          (task.description && task.description.toLowerCase().includes(q))
      )
    }

    return result
  }, [tasks, activeFilter, advancedFilters, hasAdvancedFilters, searchQuery])

  const STATUS_LABELS: Record<string, string> = {
    backlog: '未着手', todo: 'ToDo', in_progress: '進行中',
    in_review: '承認確認中', considering: '検討中', done: '完了',
  }
  const STATUS_ORDER: string[] = ['in_progress', 'todo', 'in_review', 'backlog', 'considering', 'done']

  // Group and sort tasks
  const taskGroups: TaskGroup[] = useMemo(() => {
    if (sortKey === 'due_date' || sortKey === 'created_at') {
      // Flat list sorted by due_date or created_at
      const sorted = [...filteredTasks].sort((a, b) => {
        if (sortKey === 'due_date') {
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      return [{ milestone: null, tasks: sorted }]
    }

    if (sortKey === 'assignee') {
      const byAssignee = new Map<string, Task[]>()
      filteredTasks.forEach((task) => {
        const key = task.assignee_id || '__unassigned__'
        if (!byAssignee.has(key)) byAssignee.set(key, [])
        byAssignee.get(key)!.push(task)
      })
      const groups: TaskGroup[] = []
      byAssignee.forEach((groupTasks, key) => {
        const label = key === '__unassigned__' ? '未割り当て' : getMemberName(key)
        groups.push({ milestone: null, tasks: groupTasks, label })
      })
      // Put 未割り当て last
      groups.sort((a, b) => {
        if (a.label === '未割り当て') return 1
        if (b.label === '未割り当て') return -1
        return (a.label || '').localeCompare(b.label || '')
      })
      return groups
    }

    if (sortKey === 'status') {
      const byStatus = new Map<string, Task[]>()
      filteredTasks.forEach((task) => {
        if (!byStatus.has(task.status)) byStatus.set(task.status, [])
        byStatus.get(task.status)!.push(task)
      })
      const groups: TaskGroup[] = []
      STATUS_ORDER.forEach((status) => {
        const groupTasks = byStatus.get(status)
        if (groupTasks && groupTasks.length > 0) {
          groups.push({ milestone: null, tasks: groupTasks, label: STATUS_LABELS[status] || status })
        }
      })
      return groups
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
  }, [filteredTasks, milestones, sortKey, getMemberName])

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
      wikiPageId?: string | null
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

      // Validation: wiki_page_id or spec_path is required for decided/implemented
      if (decisionState !== 'considering' && !task.wiki_page_id && !task.spec_path) {
        throw new Error('仕様書のWikiページが紐付けられていません')
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
        onDuplicate={() => {
          setDuplicateSource(selectedTask)
          syncUrlWithState(true, null, activeFilter)
        }}
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
    setSelectedTaskIds(new Set())
  }, [syncUrlWithState, isCreateOpen, selectedTaskId])

  const handleCreateClose = useCallback(() => {
    syncUrlWithState(false, selectedTaskId, activeFilter)
  }, [syncUrlWithState, selectedTaskId, activeFilter])

  const handleCreateOpen = useCallback(() => {
    syncUrlWithState(true, selectedTaskId, activeFilter)
  }, [syncUrlWithState, selectedTaskId, activeFilter])

  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus()
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'n', handler: handleCreateOpen },
    { key: '/', handler: handleFocusSearch },
  ])

  // Flat virtual rows for virtualized rendering
  const virtualRows: VirtualRow[] = useMemo(() => {
    const rows: VirtualRow[] = []
    const showHeader = sortKey === 'milestone' || sortKey === 'assignee' || sortKey === 'status'
    for (const group of taskGroups) {
      const groupKey = group.milestone?.id || group.label || '__none__'
      const isCollapsed = collapsedGroups.has(groupKey)
      if (showHeader) {
        rows.push({ type: 'header', group, groupKey })
      }
      if (!isCollapsed) {
        for (const task of group.tasks) {
          rows.push({ type: 'task', task, indent: showHeader })
        }
        rows.push({ type: 'inline', milestoneId: group.milestone?.id || null, indent: showHeader, groupKey })
      }
    }
    return rows
  }, [taskGroups, collapsedGroups, sortKey])

  // Flat visible task IDs for keyboard navigation (respects grouping + collapsed)
  const flatVisibleTaskIds = useMemo(() => {
    return virtualRows
      .filter((r): r is VirtualRow & { type: 'task' } => r.type === 'task')
      .map((r) => r.task.id)
  }, [virtualRows])

  // Map taskId → virtual row index for scroll-to
  const taskIdToVirtualIndex = useMemo(() => {
    const map = new Map<string, number>()
    virtualRows.forEach((row, i) => {
      if (row.type === 'task') map.set(row.task.id, i)
    })
    return map
  }, [virtualRows])

  // Scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
    getItemKey: (index) => {
      const row = virtualRows[index]
      if (row.type === 'header') return `h-${row.groupKey}`
      if (row.type === 'task') return row.task.id
      return `i-${row.groupKey}`
    },
  })

  // Stable ref for virtualizer to use in keyboard handler
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer
  const taskIdToVirtualIndexRef = useRef(taskIdToVirtualIndex)
  taskIdToVirtualIndexRef.current = taskIdToVirtualIndex

  // ↑↓ keyboard navigation for task list
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'j' && e.key !== 'k') return
      if (flatVisibleTaskIds.length === 0) return

      e.preventDefault()
      const currentIndex = selectedTaskId ? flatVisibleTaskIds.indexOf(selectedTaskId) : -1
      let nextIndex: number

      if (e.key === 'ArrowDown' || e.key === 'j') {
        nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, flatVisibleTaskIds.length - 1)
      } else {
        nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1
      }

      const nextId = flatVisibleTaskIds[nextIndex]
      if (nextId && nextId !== selectedTaskId) {
        syncUrlWithState(isCreateOpen, nextId, activeFilter)
        // Scroll virtual list to the selected task
        const vIndex = taskIdToVirtualIndexRef.current.get(nextId)
        if (vIndex !== undefined) {
          virtualizerRef.current.scrollToIndex(vIndex, { align: 'auto' })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatVisibleTaskIds, selectedTaskId, syncUrlWithState, isCreateOpen, activeFilter])

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
        wikiPageId: data.wikiPageId,
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
      // Highlight new task briefly
      setRecentTaskIds((prev) => new Set(prev).add(created.id))
      setTimeout(() => {
        setRecentTaskIds((prev) => {
          const next = new Set(prev)
          next.delete(created.id)
          return next
        })
      }, 5000)
      toast.success('タスクを作成しました', {
        description: 'ボール・関係者の設定は次回作成時に保持されます',
        action: {
          label: 'リセット',
          onClick: () => {
            setLastBallBySpace((prev) => ({ ...prev, [spaceId]: 'internal' }))
            setLastClientOwnersBySpace((prev) => ({ ...prev, [spaceId]: [] }))
          },
        },
      })
    } catch {
      toast.error('タスクの作成に失敗しました')
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

  // Context menu handlers
  const handleContextMenu = useCallback((taskId: string, x: number, y: number) => {
    setContextMenu({ taskId, x, y })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Inline task creation
  const handleInlineCreate = useCallback(async (title: string, milestoneId?: string | null) => {
    if (!title.trim()) return
    try {
      const created = await createTask({
        title: title.trim(),
        type: 'task',
        ball: lastBall,
        origin: 'internal',
        clientScope: 'internal',
        clientOwnerIds: lastClientOwnerIds,
        internalOwnerIds: [],
        milestoneId: milestoneId || undefined,
      })
      setRecentTaskIds((prev) => new Set(prev).add(created.id))
      setTimeout(() => {
        setRecentTaskIds((prev) => { const next = new Set(prev); next.delete(created.id); return next })
      }, 5000)
      toast.success('タスクを作成しました')
    } catch {
      toast.error('タスクの作成に失敗しました')
    }
  }, [createTask, lastBall, lastClientOwnerIds])

  // Bulk selection handlers
  const bulkMode = selectedTaskIds.size > 0

  const handleCheckChange = useCallback((taskId: string, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(taskId)
      } else {
        next.delete(taskId)
      }
      return next
    })
  }, [])

  const handleDeselectAll = useCallback(() => {
    setSelectedTaskIds(new Set())
  }, [])

  const handleBulkStatusChange = useCallback(async (status: TaskStatus) => {
    const ids = Array.from(selectedTaskIds)
    await Promise.all(ids.map((id) => updateTask(id, { status })))
    setSelectedTaskIds(new Set())
    toast.success(`${ids.length}件のステータスを変更しました`)
  }, [selectedTaskIds, updateTask])

  const handleBulkBallChange = useCallback(async (ball: BallSide) => {
    const ids = Array.from(selectedTaskIds)
    if (ball === 'client') {
      const noClientOwner = ids.filter((id) => {
        const taskOwners = owners[id] || []
        return taskOwners.filter((o) => o.side === 'client').length === 0
      })
      if (noClientOwner.length > 0) {
        toast.error(`クライアント担当者が未設定のタスクが${noClientOwner.length}件あります`)
        return
      }
    }
    await Promise.all(ids.map((id) => passBall(id, ball, owners[id]?.filter(o => o.side === 'client').map(o => o.user_id) || [], owners[id]?.filter(o => o.side === 'internal').map(o => o.user_id) || [])))
    setSelectedTaskIds(new Set())
    toast.success(`${ids.length}件のボールを変更しました`)
  }, [selectedTaskIds, passBall, owners])

  // Clear selection on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedTaskIds.size > 0) {
        setSelectedTaskIds(new Set())
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskIds.size])

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'milestone', label: 'マイルストーン別' },
    { key: 'assignee', label: '担当者別' },
    { key: 'status', label: 'ステータス別' },
    { key: 'due_date', label: '期限日順' },
    { key: 'created_at', label: '作成日順' },
  ]

  const currentSortLabel = sortOptions.find((o) => o.key === sortKey)?.label || ''

  // Filter presets
  const PRESETS_KEY = `taskapp:filter-presets:${spaceId}`
  const [filterPresets, setFilterPresets] = useState<{ name: string; filters: TaskFilters }[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]')
    } catch { return [] }
  })
  const [showPresetMenu, setShowPresetMenu] = useState(false)

  const savePreset = useCallback((name: string) => {
    const newPresets = [...filterPresets, { name, filters: advancedFilters }]
    setFilterPresets(newPresets)
    localStorage.setItem(PRESETS_KEY, JSON.stringify(newPresets))
    toast.success(`フィルター「${name}」を保存しました`)
  }, [filterPresets, advancedFilters, PRESETS_KEY])

  const loadPreset = useCallback((filters: TaskFilters) => {
    setAdvancedFilters(filters)
    setShowPresetMenu(false)
  }, [])

  const deletePreset = useCallback((index: number) => {
    const newPresets = filterPresets.filter((_, i) => i !== index)
    setFilterPresets(newPresets)
    localStorage.setItem(PRESETS_KEY, JSON.stringify(newPresets))
  }, [filterPresets, PRESETS_KEY])

  // Breadcrumb items
  const breadcrumbItems = [
    { label: spaceName || 'プロジェクト', href: projectBasePath },
    { label: activeFilter === 'client_wait' ? '確認待ち' : 'タスク' },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <InternalOnboardingWalkthrough />
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
            <ActiveFilterChips
              filters={advancedFilters}
              onFiltersChange={setAdvancedFilters}
              milestones={milestones}
              owners={uniqueOwners}
            />
          )}

          {/* Filter presets */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPresetMenu(!showPresetMenu)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="フィルタープリセット"
            >
              <BookmarkSimple className="text-sm" />
            </button>
            {showPresetMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPresetMenu(false)} />
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 min-w-[180px]">
                  {filterPresets.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">保存済みプリセットなし</div>
                  )}
                  {filterPresets.map((preset, i) => (
                    <div key={i} className="flex items-center gap-1 px-1">
                      <button
                        type="button"
                        onClick={() => loadPreset(preset.filters)}
                        className="flex-1 text-left px-2 py-1.5 text-xs hover:bg-gray-50 rounded transition-colors truncate"
                      >
                        {preset.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePreset(i)}
                        className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors flex-shrink-0"
                      >
                        <Trash className="text-xs" />
                      </button>
                    </div>
                  ))}
                  {hasAdvancedFilters && (
                    <>
                      <hr className="my-1 border-gray-100" />
                      <button
                        type="button"
                        onClick={() => {
                          const name = prompt('プリセット名を入力')
                          if (name) { savePreset(name); setShowPresetMenu(false) }
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        + 現在のフィルターを保存
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Search */}
          <div className="relative flex items-center">
            <MagnifyingGlass className="absolute left-2 text-sm text-gray-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="検索... (/)"
              className="w-40 pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:w-56 transition-all bg-white placeholder-gray-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-gray-400 hover:text-gray-600"
              >
                <XIcon className="text-xs" />
              </button>
            )}
          </div>

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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loading && <div className="content-wrap py-4"><LoadingState /></div>}
        {error && <div className="content-wrap py-4"><ErrorRetry onRetry={fetchTasks} /></div>}
        {!loading && !error && filteredTasks.length === 0 && (
          <div className="content-wrap py-4">
            <EmptyState
              icon={searchQuery ? <MagnifyingGlass /> : <Copy />}
              message={searchQuery ? `「${searchQuery}」に一致するタスクはありません` : 'タスクはありません'}
              action={searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  検索をクリア
                </button>
              ) : undefined}
            />
          </div>
        )}
        {!loading && !error && filteredTasks.length > 0 && (
          <div
            className="border-t border-gray-100"
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = virtualRows[vItem.index]
              let content: ReactElement
              if (row.type === 'header') {
                content = (
                  <MilestoneGroupHeader
                    milestone={row.group.milestone}
                    taskCount={row.group.tasks.length}
                    doneCount={row.group.tasks.filter((t) => t.status === 'done').length}
                    isCollapsed={collapsedGroups.has(row.groupKey)}
                    onToggle={() => handleToggleGroup(row.group.milestone?.id || row.group.label || null)}
                    label={row.group.label}
                  />
                )
              } else if (row.type === 'task') {
                content = (
                  <TaskRow
                    task={row.task}
                    isSelected={row.task.id === selectedTaskId}
                    onClick={handleTaskSelect}
                    indent={row.indent}
                    onStatusChange={handleStatusChange}
                    reviewStatus={reviewStatuses[row.task.id]}
                    assigneeName={row.task.assignee_id ? getMemberName(row.task.assignee_id) : null}
                    isNew={recentTaskIds.has(row.task.id)}
                    bulkMode={bulkMode}
                    isChecked={selectedTaskIds.has(row.task.id)}
                    onCheckChange={handleCheckChange}
                    onContextMenu={handleContextMenu}
                  />
                )
              } else {
                content = (
                  <InlineTaskInput
                    indent={row.indent}
                    onSubmit={(title) => handleInlineCreate(title, row.milestoneId)}
                  />
                )
              }
              return (
                <div
                  key={vItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: vItem.size,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {content}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (() => {
        const ctxTask = tasks.find((t) => t.id === contextMenu.taskId)
        if (!ctxTask) return null
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
            <div
              className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] animate-dialog-in"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                type="button"
                onClick={() => { handleStatusChange(ctxTask.id, ctxTask.status === 'done' ? 'todo' : 'done'); closeContextMenu() }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors text-left"
              >
                {ctxTask.status === 'done' ? (
                  <><Circle className="text-gray-400" /> 未完了に戻す</>
                ) : (
                  <><CheckCircle weight="fill" className="text-green-500" /> 完了にする</>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicateSource(ctxTask)
                  syncUrlWithState(true, null, activeFilter)
                  closeContextMenu()
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors text-left"
              >
                <Copy className="text-gray-400" /> 複製
              </button>
              <hr className="my-1 border-gray-100" />
              <button
                type="button"
                onClick={async () => { await handleDeleteTask(ctxTask.id); closeContextMenu() }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
              >
                削除
              </button>
            </div>
          </>
        )
      })()}

      {/* Bulk action toolbar */}
      {bulkMode && (
        <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-5 py-2 flex items-center gap-3 animate-slide-down">
          <span className="text-xs font-medium text-gray-700">
            {selectedTaskIds.size}件選択
          </span>

          <div className="h-4 w-px bg-gray-300" />

          {/* Bulk status change */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleBulkStatusChange('todo')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-colors"
              title="Todoに変更"
            >
              <Circle className="text-sm text-gray-400" />
              Todo
            </button>
            <button
              type="button"
              onClick={() => handleBulkStatusChange('in_progress')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-colors"
              title="進行中に変更"
            >
              <Circle weight="fill" className="text-sm text-blue-400" />
              進行中
            </button>
            <button
              type="button"
              onClick={() => handleBulkStatusChange('done')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-colors"
              title="完了に変更"
            >
              <CheckCircle weight="fill" className="text-sm text-green-500" />
              完了
            </button>
          </div>

          <div className="h-4 w-px bg-gray-300" />

          {/* Bulk ball change */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleBulkBallChange('internal')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-colors"
              title="ボールを社内に"
            >
              <ArrowRight weight="bold" className="text-xs text-blue-500" />
              社内
            </button>
            <button
              type="button"
              onClick={() => handleBulkBallChange('client')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 rounded border border-transparent hover:border-amber-200 transition-colors"
              title="ボールをクライアントに"
            >
              <ArrowRight weight="bold" className="text-xs text-amber-500" />
              クライアント
            </button>
          </div>

          <div className="flex-1" />

          {/* Deselect */}
          <button
            type="button"
            onClick={handleDeselectAll}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-white rounded transition-colors"
          >
            <XIcon className="text-xs" />
            選択解除
          </button>
        </div>
      )}

      <TaskCreateSheet
        spaceId={spaceId}
        orgId={orgId}
        spaceName={spaceName}
        isOpen={isCreateOpen}
        onClose={() => { handleCreateClose(); setDuplicateSource(null) }}
        onSubmit={handleCreateSubmit}
        defaultBall={duplicateSource ? duplicateSource.ball : lastBall}
        defaultClientOwnerIds={lastClientOwnerIds}
        defaultTitle={duplicateSource ? `${duplicateSource.title}（コピー）` : ''}
        defaultDescription={duplicateSource?.description || ''}
        parentTasks={parentTaskOptions}
      />
    </div>
  )
}
