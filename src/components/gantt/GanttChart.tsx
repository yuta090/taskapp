'use client'

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import {
  CalendarBlank,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ListBullets,
  Rows,
  LinkBreak,
} from '@phosphor-icons/react'
import { GANTT_CONFIG, VIEW_MODE_CONFIG, type ViewMode } from '@/lib/gantt/constants'
import {
  calcDateRange,
  getDatesInRange,
  isToday,
  dateToX,
} from '@/lib/gantt/dateUtils'
import { getEligibleParents, isParentTask } from '@/lib/gantt/treeUtils'
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
}

interface TaskGroup {
  milestone: Milestone | null
  tasks: Task[]
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
}: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [groupByMilestone, setGroupByMilestone] = useState(true)
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

  // Group tasks by milestone
  const taskGroups: TaskGroup[] = useMemo(() => {
    if (!groupByMilestone) {
      return [{ milestone: null, tasks }]
    }

    const groups: TaskGroup[] = []
    const tasksByMilestone = new Map<string | null, Task[]>()
    tasks.forEach((task) => {
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
        groups.push({ milestone, tasks: milestoneTasks })
      }
    })

    const noMilestoneTasks = tasksByMilestone.get(null) || []
    if (noMilestoneTasks.length > 0) {
      groups.push({ milestone: null, tasks: noMilestoneTasks })
    }

    return groups
  }, [tasks, milestones, groupByMilestone])

  // Build row data array (memoized to avoid rebuild on every render)
  const rowData = useMemo(() => {
    const rows: Array<{ type: 'header' | 'task'; milestone?: Milestone | null; task?: Task; rowIndex: number }> = []
    let idx = 0

    taskGroups.forEach((group) => {
      if (groupByMilestone) {
        rows.push({ type: 'header', milestone: group.milestone, rowIndex: idx })
        idx++
      }
      group.tasks.forEach((task) => {
        rows.push({ type: 'task', task, rowIndex: idx })
        idx++
      })
    })

    return rows
  }, [taskGroups, groupByMilestone])

  const totalRows = rowData.length
  const chartHeight = totalRows * GANTT_CONFIG.ROW_HEIGHT
  const rowDataRef = useRef(rowData)

  useEffect(() => {
    rowDataRef.current = rowData
  }, [rowData])

  // Today line position
  const todayIndex = dates.findIndex((d) => isToday(d))
  const todayX = todayIndex >= 0 ? dateToX(new Date(), startDate, dayWidth) : null

  const scrollToToday = () => {
    if (scrollContainerRef.current && todayIndex >= 0) {
      const scrollX = todayIndex * dayWidth - scrollContainerRef.current.clientWidth / 2
      scrollContainerRef.current.scrollTo({ left: scrollX, behavior: 'smooth' })
    }
  }

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

  // ----- Link drag logic -----

  // Eligible targets for current link drag
  const eligibleTargetIds = useMemo(() => {
    if (!linkDrag) return new Set<string>()

    const ids = new Set<string>()
    if (linkDrag.mode === 'child') {
      // Source wants to become a child => target must be eligible parent
      // Also check: source must not already be a parent (1-level hierarchy)
      if (isParentTask(linkDrag.sourceTaskId, tasks)) return ids

      const eligible = getEligibleParents(tasks, linkDrag.sourceTaskId)
      eligible.forEach((t) => ids.add(t.id))
      // Remove tasks that already have this task as parent
      tasks.forEach((t) => {
        if (t.parent_task_id === linkDrag.sourceTaskId) ids.delete(t.id)
      })
    } else {
      // Source wants to become a parent => target must be non-parent (can become child)
      // Also check: source must not already be a child (1-level hierarchy)
      const sourceTask = tasks.find((t) => t.id === linkDrag.sourceTaskId)
      if (sourceTask?.parent_task_id) return ids // source is already a child, can't be parent

      tasks.forEach((t) => {
        if (t.id === linkDrag.sourceTaskId) return
        // Target must not already be a parent (1-level: no grandchildren)
        if (isParentTask(t.id, tasks)) return
        // Target CAN already have a parent — we just re-assign it
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
        className="flex items-center justify-between px-4 border-b flex-shrink-0"
        style={{
          height: 44,
          borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
          backgroundColor: GANTT_CONFIG.COLORS.HEADER_BG,
        }}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-gray-900">ガントチャート</h2>
          <span className="text-xs text-gray-500">
            {tasks.length} タスク
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setGroupByMilestone(!groupByMilestone)}
            className={`p-1.5 rounded transition-colors ${
              groupByMilestone
                ? 'bg-gray-200 text-gray-900'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            title={groupByMilestone ? 'フラット表示' : 'マイルストーン別'}
            aria-label={groupByMilestone ? 'フラット表示にする' : 'マイルストーン別にする'}
          >
            {groupByMilestone ? (
              <Rows className="w-4 h-4" />
            ) : (
              <ListBullets className="w-4 h-4" />
            )}
          </button>

          <div className="w-px h-4 bg-gray-200 mx-1" />

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

          <div className="w-px h-4 bg-gray-200 mx-2" />

          <button
            onClick={scrollToToday}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <CalendarBlank className="w-3.5 h-3.5" />
            今日
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
              return (
                <div
                  key={`header-${row.milestone?.id || 'none'}`}
                  className="flex items-center px-3 bg-gray-50 border-b font-medium"
                  style={{
                    height: GANTT_CONFIG.ROW_HEIGHT,
                    borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
                  }}
                >
                  <div
                    className="w-2 h-2 rotate-45 mr-2 flex-shrink-0"
                    style={{
                      backgroundColor: row.milestone
                        ? GANTT_CONFIG.COLORS.MILESTONE
                        : GANTT_CONFIG.COLORS.TEXT_MUTED,
                    }}
                  />
                  <span
                    className="text-xs truncate flex-1"
                    style={{
                      color: row.milestone
                        ? GANTT_CONFIG.COLORS.MILESTONE
                        : GANTT_CONFIG.COLORS.TEXT_SECONDARY,
                    }}
                  >
                    {row.milestone?.name || 'マイルストーン未設定'}
                  </span>
                  {row.milestone && riskForecasts?.get(row.milestone.id) && (() => {
                    const risk = riskForecasts.get(row.milestone!.id)!
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

            return (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task.id)}
                className="flex items-center gap-2 cursor-pointer transition-colors hover:bg-gray-50 group"
                style={{
                  height: GANTT_CONFIG.ROW_HEIGHT,
                  backgroundColor: isSelected ? '#F1F5F9' : undefined,
                  borderBottom: `0.5px solid ${GANTT_CONFIG.COLORS.GRID_LINE}`,
                  paddingLeft: hasParent
                    ? (groupByMilestone ? 28 : 16)
                    : (groupByMilestone ? 21 : 9),
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

          {tasks.length === 0 && (
            <div
              className="flex items-center justify-center text-gray-400"
              style={{
                height: GANTT_CONFIG.ROW_HEIGHT * 3,
                fontSize: GANTT_CONFIG.FONT.SIZE_SM,
              }}
            >
              タスクがありません
            </div>
          )}
        </div>

        {/* Scrollable chart */}
        <div
          ref={chartBodyRef}
          className="flex-1 overflow-auto"
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
                    <g key={`header-${row.milestone?.id || 'none'}`}>
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

              {/* Milestones (only when not grouped) */}
              {!groupByMilestone && milestones.map((milestone) => (
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
            {tasks.length === 0 && (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                タスクがありません
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
          <span>外部確認待ち</span>
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
  todo: 'ToDo',
  in_progress: '進行中',
  in_review: '承認確認中',
  done: '完了',
  considering: '検討中',
}
