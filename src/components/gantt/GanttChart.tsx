'use client'

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import {
  CalendarBlank,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  LinkBreak,
  FunnelSimple,
  SortAscending,
  SortDescending,
} from '@phosphor-icons/react'
import { GANTT_CONFIG, VIEW_MODE_CONFIG, type ViewMode } from '@/lib/gantt/constants'
import {
  calcDateRange,
  getDatesInRange,
  isToday,
  dateToX,
} from '@/lib/gantt/dateUtils'
import { getDescendantIds, getAncestorIds, buildTaskTree } from '@/lib/gantt/treeUtils'
import { GanttHeader } from './GanttHeader'
import { GanttRow } from './GanttRow'
import { GanttMilestone } from './GanttMilestone'
import type { Task, Milestone } from '@/types/database'
import type { RiskAssessment } from '@/lib/risk/calculateRisk'

interface GanttChartProps {
  tasks: Task[]
  milestones: Milestone[]
  riskForecasts?: Map<string, RiskAssessment>
  selectedTaskId?: string
  onTaskClick?: (taskId: string) => void
  onDateChange?: (taskId: string, field: 'start' | 'end', newDate: string) => void
  onBarMove?: (taskId: string, newStart: string, newEnd: string) => void
  onParentChange?: (taskId: string, parentTaskId: string | null) => void
  onMilestoneDateChange?: (milestoneId: string, startDate: string | null, dueDate: string | null) => void
}

type GroupBy = 'none' | 'milestone' | 'ball' | 'parent'
type StatusFilter = 'all' | 'not_done' | 'backlog' | 'in_progress' | 'in_review' | 'done'
type SortOrder = 'asc' | 'desc'

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'milestone', label: 'マイルストーン' },
  { value: 'ball', label: 'ボール所在' },
  { value: 'parent', label: '親タスク' },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'not_done', label: '完了以外' },
  { value: 'backlog', label: '未着手' },
  { value: 'in_progress', label: '進行中' },
  { value: 'in_review', label: '社内承認中' },
  { value: 'done', label: '完了' },
]

interface TaskGroup {
  label: string
  groupKey: string
  tasks: Task[]
  color?: string
}

interface LinkDragState {
  sourceTaskId: string
  mode: 'child' | 'parent'
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export function GanttChart({
  tasks,
  milestones,
  riskForecasts,
  selectedTaskId,
  onTaskClick,
  onDateChange,
  onBarMove,
  onParentChange,
  onMilestoneDateChange,
}: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [groupBy, setGroupBy] = useState<GroupBy>('milestone')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('not_done')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const chartBodyRef = useRef<HTMLDivElement>(null)
  const chartSvgRef = useRef<SVGSVGElement>(null)

  // Link drag state
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null)
  const linkDragRef = useRef<LinkDragState | null>(null)
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null)
  const hoverTaskIdRef = useRef<string | null>(null)

  // Calculate date range
  const { start: startDate, end: endDate } = useMemo(
    () => calcDateRange(tasks, milestones),
    [tasks, milestones]
  )

  const dayWidth = VIEW_MODE_CONFIG[viewMode].dayWidth
  const dates = useMemo(
    () => getDatesInRange(startDate, endDate),
    [startDate, endDate]
  )

  const totalWidth = dates.length * dayWidth

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    let result = tasks
    if (statusFilter === 'not_done') {
      result = result.filter((t) => t.status !== 'done')
    } else if (statusFilter === 'backlog') {
      result = result.filter((t) => t.status === 'backlog' || t.status === 'todo' || t.status === 'considering')
    } else if (statusFilter === 'in_progress') {
      result = result.filter((t) => t.status === 'in_progress')
    } else if (statusFilter === 'in_review') {
      result = result.filter((t) => t.status === 'in_review')
    } else if (statusFilter === 'done') {
      result = result.filter((t) => t.status === 'done')
    }
    // Sort by start_date (or created_at as fallback)
    result = [...result].sort((a, b) => {
      const dateA = a.start_date || a.created_at
      const dateB = b.start_date || b.created_at
      const cmp = dateA < dateB ? -1 : dateA > dateB ? 1 : 0
      return sortOrder === 'asc' ? cmp : -cmp
    })
    return result
  }, [tasks, statusFilter, sortOrder])

  // Group tasks
  const taskGroups: TaskGroup[] = useMemo(() => {
    if (groupBy === 'none') {
      return [{ label: '', groupKey: 'all', tasks: filteredTasks }]
    }

    if (groupBy === 'milestone') {
      const groups: TaskGroup[] = []
      const tasksByMilestone = new Map<string | null, Task[]>()
      filteredTasks.forEach((task) => {
        const key = task.milestone_id || null
        if (!tasksByMilestone.has(key)) {
          tasksByMilestone.set(key, [])
        }
        tasksByMilestone.get(key)!.push(task)
      })

      const sortedMilestones = [...milestones].sort((a, b) => a.order_key - b.order_key)
      sortedMilestones.forEach((milestone) => {
        const milestoneTasks = tasksByMilestone.get(milestone.id) || []
        if (milestoneTasks.length > 0) {
          groups.push({
            label: milestone.name,
            groupKey: milestone.id,
            tasks: milestoneTasks,
            color: GANTT_CONFIG.COLORS.MILESTONE,
          })
        }
      })

      const noMilestoneTasks = tasksByMilestone.get(null) || []
      if (noMilestoneTasks.length > 0) {
        groups.push({ label: 'マイルストーン未設定', groupKey: 'none', tasks: noMilestoneTasks })
      }
      return groups
    }

    if (groupBy === 'ball') {
      const groups: TaskGroup[] = []
      const byBall = new Map<string, Task[]>()
      filteredTasks.forEach((t) => {
        const key = t.ball
        if (!byBall.has(key)) byBall.set(key, [])
        byBall.get(key)!.push(t)
      })
      const ballLabels: Record<string, string> = { client: 'クライアント確認待ち', internal: '社内対応中' }
      const ballColors: Record<string, string> = { client: GANTT_CONFIG.COLORS.CLIENT, internal: GANTT_CONFIG.COLORS.INTERNAL }
      for (const [ball, ts] of byBall) {
        groups.push({ label: ballLabels[ball] || ball, groupKey: ball, tasks: ts, color: ballColors[ball] })
      }
      return groups
    }

    if (groupBy === 'parent') {
      const groups: TaskGroup[] = []
      const taskMap = new Map(filteredTasks.map((t) => [t.id, t]))
      const topLevel = filteredTasks.filter((t) => !t.parent_task_id || !taskMap.has(t.parent_task_id))
      const children = filteredTasks.filter((t) => t.parent_task_id && taskMap.has(t.parent_task_id))
      const byParent = new Map<string, Task[]>()
      children.forEach((t) => {
        if (!byParent.has(t.parent_task_id!)) byParent.set(t.parent_task_id!, [])
        byParent.get(t.parent_task_id!)!.push(t)
      })
      // Group: each parent with its children
      topLevel.forEach((parent) => {
        const childTasks = byParent.get(parent.id) || []
        groups.push({
          label: parent.title,
          groupKey: parent.id,
          tasks: [parent, ...childTasks],
          color: GANTT_CONFIG.COLORS.PARENT_BAR,
        })
        byParent.delete(parent.id)
      })
      return groups
    }

    return [{ label: '', groupKey: 'all', tasks: filteredTasks }]
  }, [filteredTasks, groupBy, milestones])

  // Build global tree for depth and ordering (accounts for cross-milestone parent-child)
  const globalTreeDepthMap = useMemo(() => {
    const treeNodes = buildTaskTree(filteredTasks)
    const depthMap = new Map<string, number>()
    treeNodes.forEach((node) => depthMap.set(node.task.id, node.depth))
    return depthMap
  }, [filteredTasks])

  const isGrouped = groupBy !== 'none'

  // Build row data array with tree ordering and depth (memoized)
  const rowData = useMemo(() => {
    const rows: Array<{ type: 'header' | 'task'; group?: TaskGroup; task?: Task; depth?: number; rowIndex: number }> = []
    let idx = 0

    taskGroups.forEach((group) => {
      if (isGrouped) {
        rows.push({ type: 'header', group, rowIndex: idx })
        idx++
      }
      // Use buildTaskTree for ordering within each group, but use global depth
      const treeNodes = buildTaskTree(group.tasks)
      treeNodes.forEach((node) => {
        const globalDepth = globalTreeDepthMap.get(node.task.id) ?? node.depth
        rows.push({ type: 'task', task: node.task, depth: globalDepth, rowIndex: idx })
        idx++
      })
    })

    return rows
  }, [taskGroups, isGrouped, globalTreeDepthMap])

  const totalRows = rowData.length
  const chartHeight = totalRows * GANTT_CONFIG.ROW_HEIGHT
  const rowDataRef = useRef(rowData)

  useEffect(() => {
    rowDataRef.current = rowData
  }, [rowData])

  // Today line position
  const todayIndex = dates.findIndex((d) => isToday(d))
  const todayX = todayIndex >= 0 ? dateToX(new Date(), startDate, dayWidth) : null

  // Horizontal scroll must target the chart body (chartBodyRef): its onScroll
  // handler mirrors scrollLeft to the date header (scrollContainerRef), but
  // there is no sync in the other direction, so scrolling the header alone
  // moves nothing visible.
  const scrollToToday = () => {
    if (chartBodyRef.current && todayIndex >= 0) {
      const scrollX = todayIndex * dayWidth - chartBodyRef.current.clientWidth / 2
      chartBodyRef.current.scrollTo({ left: scrollX, behavior: 'smooth' })
    }
  }

  // Auto-center on today once when the chart first mounts, so it doesn't
  // default to the left (past) edge of an empty-looking grid. Must run only
  // once: later re-renders (e.g. task edits) shouldn't yank the user's scroll
  // position back to today.
  const hasAutoScrolledRef = useRef(false)
  useEffect(() => {
    if (hasAutoScrolledRef.current) return
    const container = chartBodyRef.current
    const header = scrollContainerRef.current
    if (!container || typeof container.scrollTo !== 'function') return
    hasAutoScrolledRef.current = true

    let scrollX: number | null = null
    if (todayIndex >= 0) {
      scrollX = Math.max(0, todayIndex * dayWidth - container.clientWidth / 2)
    } else if (new Date() > endDate) {
      // Today is after the whole range (all-past project) - land on the right edge
      scrollX = totalWidth
    }
    if (scrollX !== null) {
      container.scrollTo({ left: scrollX, behavior: 'auto' })
      // The body→header onScroll sync only fires on user scroll events in some
      // browsers' programmatic-scroll timing; set the header directly too.
      header?.scrollTo({ left: scrollX, behavior: 'auto' })
    }
    // Intentionally run once on mount only - see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync vertical scroll between sidebar and chart
  const handleChartScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (sidebarRef.current) {
      sidebarRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }, [])

  // View mode cycling
  const cycleViewMode = (direction: 'in' | 'out') => {
    const modes: ViewMode[] = ['month', 'week', 'day']
    const currentIndex = modes.indexOf(viewMode)
    if (direction === 'in' && currentIndex < modes.length - 1) {
      setViewMode(modes[currentIndex + 1])
    } else if (direction === 'out' && currentIndex > 0) {
      setViewMode(modes[currentIndex - 1])
    }
  }

  // ----- Middle-button pan (grab scroll) -----
  const panStateRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  useEffect(() => {
    const chartBody = chartBodyRef.current
    if (!chartBody) return

    const handleMouseDown = (e: MouseEvent) => {
      // Middle button (1) or left button with Space key
      if (e.button !== 1) return
      e.preventDefault()
      panStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: chartBody.scrollLeft,
        scrollTop: chartBody.scrollTop,
      }
      setIsPanning(true)
    }

    const handleMouseMove = (e: MouseEvent) => {
      const pan = panStateRef.current
      if (!pan) return
      const dx = e.clientX - pan.startX
      const dy = e.clientY - pan.startY
      chartBody.scrollLeft = pan.scrollLeft - dx
      chartBody.scrollTop = pan.scrollTop - dy
    }

    const handleMouseUp = () => {
      if (panStateRef.current) {
        panStateRef.current = null
        setIsPanning(false)
      }
    }

    chartBody.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      chartBody.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // ----- Link drag logic -----

  // Eligible targets for current link drag (multi-level hierarchy)
  const eligibleTargetIds = useMemo(() => {
    if (!linkDrag) return new Set<string>()

    const ids = new Set<string>()
    if (linkDrag.mode === 'child') {
      // Source wants to become a child of target
      // Exclude: source itself + source's descendants (would create a cycle)
      const descendantIds = getDescendantIds(linkDrag.sourceTaskId, tasks)
      tasks.forEach((t) => {
        if (t.id === linkDrag.sourceTaskId) return
        if (descendantIds.has(t.id)) return
        ids.add(t.id)
      })
    } else {
      // Source wants to become parent of target (target becomes child)
      // Exclude: source itself + source's ancestors (would create a cycle)
      const ancestorIds = getAncestorIds(linkDrag.sourceTaskId, tasks)
      tasks.forEach((t) => {
        if (t.id === linkDrag.sourceTaskId) return
        if (ancestorIds.has(t.id)) return
        ids.add(t.id)
      })
    }

    return ids
  }, [linkDrag, tasks])
  const eligibleTargetIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    eligibleTargetIdsRef.current = eligibleTargetIds
  }, [eligibleTargetIds])

  const handleLinkDragStart = useCallback(
    (taskId: string, mode: 'child' | 'parent', startX: number, startY: number) => {
      const state: LinkDragState = {
        sourceTaskId: taskId,
        mode,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
      }
      linkDragRef.current = state
      setLinkDrag(state)
    },
    []
  )

  // Global mouse handlers for link drag
  const isLinkDragging = linkDrag !== null
  useEffect(() => {
    if (!isLinkDragging) return

    const toSvgPoint = (clientX: number, clientY: number) => {
      const svg = chartSvgRef.current
      if (svg) {
        const ctm = svg.getScreenCTM()
        if (ctm) {
          const point = svg.createSVGPoint()
          point.x = clientX
          point.y = clientY
          const transformed = point.matrixTransform(ctm.inverse())
          return { x: transformed.x, y: transformed.y }
        }
      }

      const container = chartBodyRef.current
      if (!container) return null
      const rect = container.getBoundingClientRect()
      return {
        x: clientX - rect.left + container.scrollLeft,
        y: clientY - rect.top + container.scrollTop,
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const currentDrag = linkDragRef.current
      if (!currentDrag) return
      const svgPoint = toSvgPoint(e.clientX, e.clientY)
      if (!svgPoint) return

      const newState: LinkDragState = {
        ...currentDrag,
        currentX: svgPoint.x,
        currentY: svgPoint.y,
      }
      linkDragRef.current = newState
      setLinkDrag(newState)

      // Determine which task row the cursor is over
      const hoverRowIndex = Math.floor(svgPoint.y / GANTT_CONFIG.ROW_HEIGHT)
      const hoveredRow = hoverRowIndex >= 0 ? rowDataRef.current[hoverRowIndex] : undefined
      const hoveredId = hoveredRow?.type === 'task' && hoveredRow.task ? hoveredRow.task.id : null
      hoverTaskIdRef.current = hoveredId
      setHoverTaskId(hoveredId)
    }

    const handleMouseUp = (e: MouseEvent) => {
      const currentDrag = linkDragRef.current
      const eligibleIds = eligibleTargetIdsRef.current

      // Re-compute target from final mouse position (more reliable than cached hoverTaskId)
      let finalTarget: string | null = null
      const svgPoint = toSvgPoint(e.clientX, e.clientY)
      if (svgPoint) {
        const rowIndex = Math.floor(svgPoint.y / GANTT_CONFIG.ROW_HEIGHT)
        const row = rowIndex >= 0 ? rowDataRef.current[rowIndex] : undefined
        finalTarget = row?.type === 'task' && row.task ? row.task.id : null
      }

      if (currentDrag && finalTarget && onParentChange && eligibleIds.has(finalTarget)) {
        if (currentDrag.mode === 'child') {
          // Source becomes child of target
          onParentChange(currentDrag.sourceTaskId, finalTarget)
        } else {
          // Target becomes child of source
          onParentChange(finalTarget, currentDrag.sourceTaskId)
        }
      }

      linkDragRef.current = null
      hoverTaskIdRef.current = null
      setLinkDrag(null)
      setHoverTaskId(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isLinkDragging, onParentChange])

  // Compute link highlight per task
  const getLinkHighlight = useCallback(
    (taskId: string) => {
      if (!linkDrag) return null
      if (taskId === linkDrag.sourceTaskId) return null
      if (!eligibleTargetIds.has(taskId)) return null

      const isOver = hoverTaskId === taskId
      return {
        type: isOver ? 'over' as const : 'eligible' as const,
        mode: linkDrag.mode,
      }
    },
    [linkDrag, eligibleTargetIds, hoverTaskId]
  )

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex flex-col gap-2 px-4 py-2 border-b flex-shrink-0"
        style={{
          borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
          backgroundColor: GANTT_CONFIG.COLORS.HEADER_BG,
        }}
      >
        {/* Row 1: Title + zoom + navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-gray-900">ガントチャート</h2>
            <span className="text-xs text-gray-400">
              {filteredTasks.length}/{tasks.length} タスク
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => cycleViewMode('out')}
              disabled={viewMode === 'month'}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="縮小"
              aria-label="縮小"
            >
              <MagnifyingGlassMinus className="w-4 h-4 text-gray-600" />
            </button>
            <span className="px-2 text-xs font-medium text-gray-600 min-w-[32px] text-center">
              {VIEW_MODE_CONFIG[viewMode].label}
            </span>
            <button
              onClick={() => cycleViewMode('in')}
              disabled={viewMode === 'day'}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="拡大"
              aria-label="拡大"
            >
              <MagnifyingGlassPlus className="w-4 h-4 text-gray-600" />
            </button>

            <div className="w-px h-4 bg-gray-200 mx-1" />

            <button
              onClick={scrollToToday}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <CalendarBlank className="w-3.5 h-3.5" />
              今日
            </button>
          </div>
        </div>

        {/* Row 2: Grouping + Status filter + Sort */}
        <div className="flex items-center gap-6 text-xs">
          {/* Grouping */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 font-medium whitespace-nowrap">グルーピング:</span>
            <div className="flex items-center gap-0.5">
              {GROUP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setGroupBy(opt.value)}
                  className={`px-2 py-1 rounded transition-colors ${
                    groupBy === opt.value
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-5 bg-gray-300 mx-2" />

          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <FunnelSimple className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-gray-500 font-medium whitespace-nowrap">状態:</span>
            <div className="flex items-center gap-0.5">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={`px-2 py-1 rounded transition-colors ${
                    statusFilter === opt.value
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-5 bg-gray-300 mx-2" />

          {/* Sort */}
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1 px-2 py-1 rounded text-gray-600 hover:bg-gray-100 transition-colors"
            title={sortOrder === 'asc' ? '開始日 昇順' : '開始日 降順'}
          >
            {sortOrder === 'asc' ? (
              <SortAscending className="w-3.5 h-3.5" />
            ) : (
              <SortDescending className="w-3.5 h-3.5" />
            )}
            <span>{sortOrder === 'asc' ? '昇順' : '降順'}</span>
          </button>
        </div>
      </div>

      {/* Chart area - header row */}
      <div className="flex flex-shrink-0" style={{ height: GANTT_CONFIG.HEADER_HEIGHT }}>
        <div
          className="flex-shrink-0 border-r border-b flex items-end px-3 pb-1"
          style={{
            width: GANTT_CONFIG.SIDEBAR_WIDTH,
            borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
            backgroundColor: GANTT_CONFIG.COLORS.HEADER_BG,
          }}
        >
          <span className="text-xs font-medium text-gray-500">タスク名</span>
        </div>

        <div className="flex-1 overflow-hidden">
          <div
            ref={scrollContainerRef}
            className="overflow-x-auto overflow-y-hidden"
            style={{ scrollBehavior: 'smooth' }}
            onScroll={handleChartScroll}
          >
            <GanttHeader
              startDate={startDate}
              endDate={endDate}
              viewMode={viewMode}
              dayWidth={dayWidth}
              sidebarWidth={0}
              milestones={milestones}
              onMilestoneDateChange={onMilestoneDateChange}
            />
          </div>
        </div>
      </div>

      {/* Chart body - scrollable */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (plain divs, no DnD) */}
        <div
          ref={sidebarRef}
          className="flex-shrink-0 border-r bg-white overflow-y-auto overflow-x-hidden"
          style={{
            width: GANTT_CONFIG.SIDEBAR_WIDTH,
            borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
          }}
        >
          {rowData.map((row) => {
            if (row.type === 'header') {
              const group = row.group!
              const groupColor = group.color || GANTT_CONFIG.COLORS.TEXT_MUTED
              // Check if this is a milestone group for risk badge
              const milestoneForRisk = groupBy === 'milestone'
                ? milestones.find((m) => m.id === group.groupKey)
                : null
              return (
                <div
                  key={`header-${group.groupKey}`}
                  className="flex items-center px-3 bg-gray-50 border-b font-medium"
                  style={{
                    height: GANTT_CONFIG.ROW_HEIGHT,
                    borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
                  }}
                >
                  <div
                    className="w-2 h-2 rotate-45 mr-2 flex-shrink-0"
                    style={{ backgroundColor: groupColor }}
                  />
                  <span
                    className="text-xs truncate flex-1"
                    style={{ color: groupColor }}
                  >
                    {group.label}
                  </span>
                  <span className="text-[10px] text-gray-400 ml-1 flex-shrink-0">
                    {group.tasks.length}
                  </span>
                  {milestoneForRisk && riskForecasts?.get(milestoneForRisk.id) && (() => {
                    const risk = riskForecasts.get(milestoneForRisk.id)!
                    if (risk.level === 'none' || risk.remainingTasks === 0) return null
                    const badgeColors = {
                      high: { bg: '#FEE2E2', text: '#DC2626' },
                      medium: { bg: '#FEF3C7', text: '#D97706' },
                      low: { bg: '#DCFCE7', text: '#16A34A' },
                    } as const
                    const c = badgeColors[risk.level as keyof typeof badgeColors]
                    if (!c) return null
                    return (
                      <span
                        className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0"
                        style={{ backgroundColor: c.bg, color: c.text }}
                        title={risk.insufficientData
                          ? `残${risk.remainingTasks}件 / データ不足`
                          : `残${risk.remainingTasks}件 / ${risk.velocity.toFixed(1)}件/日`}
                      >
                        {risk.insufficientData ? '?' : risk.level === 'high' ? '高' : risk.level === 'medium' ? '中' : '低'}
                      </span>
                    )
                  })()}
                </div>
              )
            }

            const task = row.task!
            const isSelected = task.id === selectedTaskId
            const statusColors = getStatusBadge(task.status)
            const hasParent = !!task.parent_task_id
            const depth = row.depth || 0
            const basePadding = isGrouped ? 21 : 9
            const depthIndent = depth * 16

            return (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task.id)}
                className="flex items-center gap-2 cursor-pointer transition-colors hover:bg-gray-50 group"
                style={{
                  height: GANTT_CONFIG.ROW_HEIGHT,
                  backgroundColor: isSelected ? '#F1F5F9' : undefined,
                  borderBottom: `0.5px solid ${GANTT_CONFIG.COLORS.GRID_LINE}`,
                  paddingLeft: basePadding + depthIndent,
                  paddingRight: 12,
                }}
              >
                {/* Ball indicator */}
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      task.ball === 'client'
                        ? GANTT_CONFIG.COLORS.CLIENT
                        : GANTT_CONFIG.COLORS.INTERNAL,
                  }}
                  title={task.ball === 'client' ? '外部' : '社内'}
                />

                {hasParent && (
                  <span className="text-gray-300 text-[10px] flex-shrink-0">└</span>
                )}

                <span
                  className="flex-1 truncate text-gray-900"
                  style={{
                    fontSize: GANTT_CONFIG.FONT.SIZE_SM,
                    fontWeight: isSelected ? 500 : 400,
                  }}
                >
                  {task.title}
                </span>

                {/* Remove parent button */}
                {hasParent && onParentChange && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onParentChange(task.id, null)
                    }}
                    className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                    title="親タスクの紐づけを解除"
                    aria-label="親タスクの紐づけを解除"
                  >
                    <LinkBreak className="w-3 h-3 text-gray-400" />
                  </button>
                )}

                {/* Status badge */}
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                  style={{
                    backgroundColor: statusColors.bg,
                    color: statusColors.text,
                  }}
                >
                  {statusLabels[task.status] || task.status}
                </span>
              </div>
            )
          })}

          {filteredTasks.length === 0 && (
            <div
              className="flex items-center justify-center text-gray-400"
              style={{
                height: GANTT_CONFIG.ROW_HEIGHT * 3,
                fontSize: GANTT_CONFIG.FONT.SIZE_SM,
              }}
            >
              {tasks.length === 0 ? '期限付きタスクやマイルストーンを設定するとここに表示されます' : '条件に一致するタスクがありません'}
            </div>
          )}
        </div>

        {/* Scrollable chart */}
        <div
          ref={chartBodyRef}
          className="flex-1 overflow-scroll gantt-scroll"
          style={{ cursor: isPanning ? 'grabbing' : undefined }}
          onScroll={(e) => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollLeft = e.currentTarget.scrollLeft
            }
            if (sidebarRef.current) {
              sidebarRef.current.scrollTop = e.currentTarget.scrollTop
            }
          }}
        >
          <div style={{ width: totalWidth, minHeight: '100%' }}>
            <svg
              ref={chartSvgRef}
              width={totalWidth}
              height={Math.max(chartHeight, 200)}
              className="block"
            >
              {/* Render rows */}
              {rowData.map((row) => {
                if (row.type === 'header') {
                  return (
                    <g key={`header-${row.group?.groupKey || 'none'}`}>
                      <rect
                        x={0}
                        y={row.rowIndex * GANTT_CONFIG.ROW_HEIGHT}
                        width={totalWidth}
                        height={GANTT_CONFIG.ROW_HEIGHT}
                        fill="#F8FAFC"
                      />
                      <line
                        x1={0}
                        y1={(row.rowIndex + 1) * GANTT_CONFIG.ROW_HEIGHT - 0.5}
                        x2={totalWidth}
                        y2={(row.rowIndex + 1) * GANTT_CONFIG.ROW_HEIGHT - 0.5}
                        stroke={GANTT_CONFIG.COLORS.GRID_LINE}
                        strokeWidth={1}
                      />
                    </g>
                  )
                }

                const task = row.task!
                return (
                  <GanttRow
                    key={task.id}
                    task={task}
                    startDate={startDate}
                    endDate={endDate}
                    dayWidth={dayWidth}
                    rowIndex={row.rowIndex}
                    isSelected={task.id === selectedTaskId}
                    onDateChange={onDateChange}
                    onBarMove={onBarMove}
                    onLinkDragStart={onParentChange ? handleLinkDragStart : undefined}
                    linkHighlight={getLinkHighlight(task.id)}
                  />
                )
              })}

              {/* Parent-child connection lines */}
              {rowData.map((row) => {
                if (row.type !== 'task' || !row.task?.parent_task_id) return null
                const childTask = row.task
                const parentRow = rowData.find(
                  (r) => r.type === 'task' && r.task?.id === childTask.parent_task_id
                )
                if (!parentRow || !parentRow.task) return null

                const parentEnd = parentRow.task.due_date
                const childStart = childTask.start_date || childTask.created_at

                if (!parentEnd || !childStart) return null

                const parentEndX = dateToX(new Date(parentEnd), startDate, dayWidth)
                const childStartX = dateToX(new Date(childStart), startDate, dayWidth)
                const parentY = parentRow.rowIndex * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2
                const childY = row.rowIndex * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2

                // Draw an L-shaped connector from parent bar end to child bar start
                const midX = (parentEndX + childStartX) / 2
                return (
                  <g key={`link-${childTask.id}`} style={{ pointerEvents: 'none' }}>
                    <path
                      d={`M ${parentEndX} ${parentY} L ${midX} ${parentY} L ${midX} ${childY} L ${childStartX} ${childY}`}
                      fill="none"
                      stroke="#94A3B8"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      opacity={0.6}
                    />
                    {/* Arrow at child end */}
                    <polygon
                      points={`${childStartX},${childY} ${childStartX - 5},${childY - 3} ${childStartX - 5},${childY + 3}`}
                      fill="#94A3B8"
                      opacity={0.6}
                    />
                  </g>
                )
              })}

              {/* Milestones (only when not grouped by milestone) */}
              {groupBy !== 'milestone' && milestones.map((milestone) => (
                <GanttMilestone
                  key={milestone.id}
                  milestone={milestone}
                  startDate={startDate}
                  dayWidth={dayWidth}
                  chartHeight={chartHeight}
                  risk={riskForecasts?.get(milestone.id)}
                />
              ))}

              {/* Today line */}
              {todayX !== null && (
                <g>
                  <line
                    x1={todayX}
                    y1={0}
                    x2={todayX}
                    y2={chartHeight}
                    stroke={GANTT_CONFIG.COLORS.TODAY}
                    strokeWidth={2}
                  />
                  <circle
                    cx={todayX}
                    cy={0}
                    r={4}
                    fill={GANTT_CONFIG.COLORS.TODAY}
                  />
                </g>
              )}

              {/* SVG overlay: link drag connection line */}
              {linkDrag && (
                <g style={{ pointerEvents: 'none' }}>
                  {/* Dashed connection line */}
                  <line
                    x1={linkDrag.startX}
                    y1={linkDrag.startY}
                    x2={linkDrag.currentX}
                    y2={linkDrag.currentY}
                    stroke={linkDrag.mode === 'child' ? '#6366F1' : '#10B981'}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    opacity={0.7}
                  />
                  {/* Source dot */}
                  <circle
                    cx={linkDrag.startX}
                    cy={linkDrag.startY}
                    r={4}
                    fill={linkDrag.mode === 'child' ? '#6366F1' : '#10B981'}
                  />
                  {/* Cursor dot */}
                  <circle
                    cx={linkDrag.currentX}
                    cy={linkDrag.currentY}
                    r={4}
                    fill={linkDrag.mode === 'child' ? '#6366F1' : '#10B981'}
                    opacity={0.6}
                  />
                  {/* Hint text */}
                  <text
                    x={linkDrag.currentX + 12}
                    y={linkDrag.currentY - 8}
                    fontSize={11}
                    fill={linkDrag.mode === 'child' ? '#6366F1' : '#10B981'}
                    fontWeight={600}
                  >
                    {hoverTaskId && eligibleTargetIds.has(hoverTaskId)
                      ? (linkDrag.mode === 'child' ? '子にする' : '親にする')
                      : (linkDrag.mode === 'child' ? '親タスクへドロップ' : '子タスクへドロップ')}
                  </text>
                </g>
              )}
            </svg>

            {/* Empty state */}
            {filteredTasks.length === 0 && (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                {tasks.length === 0 ? '期限付きタスクやマイルストーンを設定するとここに表示されます' : '条件に一致するタスクがありません'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div
        className="flex items-center gap-4 px-4 py-2 border-t text-xs text-gray-500 flex-shrink-0"
        style={{ borderColor: GANTT_CONFIG.COLORS.GRID_LINE }}
      >
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: GANTT_CONFIG.COLORS.CLIENT }}
          />
          <span>クライアント確認待ち</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: GANTT_CONFIG.COLORS.INTERNAL }}
          />
          <span>社内対応中</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: GANTT_CONFIG.COLORS.DONE }}
          />
          <span>完了</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rotate-45"
            style={{
              backgroundColor: GANTT_CONFIG.COLORS.MILESTONE_BG,
              border: `1px solid ${GANTT_CONFIG.COLORS.MILESTONE}`,
            }}
          />
          <span>マイルストーン</span>
        </div>
      </div>
    </div>
  )
}

function getStatusBadge(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    backlog: { bg: '#F3F4F6', text: '#6B7280' },
    todo: { bg: '#F3F4F6', text: '#6B7280' },
    in_progress: { bg: '#EFF6FF', text: '#2563EB' },
    in_review: { bg: '#FFFBEB', text: '#D97706' },
    done: { bg: '#F0FDF4', text: '#16A34A' },
    considering: { bg: '#F3F4F6', text: '#6B7280' },
  }
  return colors[status] || colors.backlog
}

const statusLabels: Record<string, string> = {
  backlog: '未着手',
  todo: '着手予定',
  in_progress: '進行中',
  in_review: '社内承認中',
  done: '完了',
  considering: '検討中',
}
