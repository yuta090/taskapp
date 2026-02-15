'use client'

import { useMemo, useState, useRef, useCallback } from 'react'
import {
  CalendarBlank,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ListBullets,
  Rows,
  CaretDown,
  CaretRight,
} from '@phosphor-icons/react'
import { GANTT_CONFIG, VIEW_MODE_CONFIG, type ViewMode } from '@/lib/gantt/constants'
import {
  calcDateRange,
  getDatesInRange,
  isToday,
  dateToX,
} from '@/lib/gantt/dateUtils'
import { buildTaskTree, type TaskTreeNode } from '@/lib/gantt/treeUtils'
import { GanttHeader } from './GanttHeader'
import { GanttRow } from './GanttRow'
import { GanttMilestone } from './GanttMilestone'
import type { Task, Milestone } from '@/types/database'

interface GanttChartProps {
  tasks: Task[]
  milestones: Milestone[]
  selectedTaskId?: string
  onTaskClick?: (taskId: string) => void
  onDateChange?: (taskId: string, field: 'start' | 'end', newDate: string) => void
}

interface TaskGroup {
  milestone: Milestone | null
  tasks: Task[]
}

type RowDataItem = {
  type: 'header' | 'task'
  milestone?: Milestone | null
  task?: Task
  rowIndex: number
  depth: number
  isParent: boolean
  isCollapsed: boolean
  childCount: number
  summaryStart?: string | null
  summaryEnd?: string | null
}

export function GanttChart({
  tasks,
  milestones,
  selectedTaskId,
  onTaskClick,
  onDateChange,
}: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [groupByMilestone, setGroupByMilestone] = useState(true)
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Toggle collapse state for a parent task
  const toggleCollapse = useCallback((taskId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }, [])

  // Build task tree (parent-child hierarchy)
  const taskTree = useMemo(() => buildTaskTree(tasks), [tasks])

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

  // Group tasks by milestone (using tree structure)
  const taskGroups: TaskGroup[] = useMemo(() => {
    if (!groupByMilestone) {
      return [{ milestone: null, tasks }]
    }

    const groups: TaskGroup[] = []
    const milestoneMap = new Map<string, Milestone>()
    milestones.forEach((m) => milestoneMap.set(m.id, m))

    // Group tasks by milestone_id
    const tasksByMilestone = new Map<string | null, Task[]>()
    tasks.forEach((task) => {
      const key = task.milestone_id || null
      if (!tasksByMilestone.has(key)) {
        tasksByMilestone.set(key, [])
      }
      tasksByMilestone.get(key)!.push(task)
    })

    // Sort milestones by order_key
    const sortedMilestones = [...milestones].sort((a, b) => a.order_key - b.order_key)

    // Add milestone groups
    sortedMilestones.forEach((milestone) => {
      const milestoneTasks = tasksByMilestone.get(milestone.id) || []
      if (milestoneTasks.length > 0) {
        groups.push({ milestone, tasks: milestoneTasks })
      }
    })

    // Add tasks without milestone
    const noMilestoneTasks = tasksByMilestone.get(null) || []
    if (noMilestoneTasks.length > 0) {
      groups.push({ milestone: null, tasks: noMilestoneTasks })
    }

    return groups
  }, [tasks, milestones, groupByMilestone])

  // Build row data with parent-child hierarchy
  const rowData: RowDataItem[] = useMemo(() => {
    const rows: RowDataItem[] = []
    let currentRowIndex = 0

    // Helper: find tree node for a task
    const treeNodeMap = new Map<string, TaskTreeNode>()
    taskTree.forEach((node) => treeNodeMap.set(node.task.id, node))

    taskGroups.forEach((group) => {
      if (groupByMilestone) {
        rows.push({
          type: 'header',
          milestone: group.milestone,
          rowIndex: currentRowIndex,
          depth: 0,
          isParent: false,
          isCollapsed: false,
          childCount: 0,
        })
        currentRowIndex++
      }

      // Process tasks in tree order within each group
      const groupTaskIds = new Set(group.tasks.map((t) => t.id))
      const processedIds = new Set<string>()

      group.tasks.forEach((task) => {
        if (processedIds.has(task.id)) return

        // Skip children (they're rendered under their parent)
        if (task.parent_task_id && groupTaskIds.has(task.parent_task_id)) return

        const node = treeNodeMap.get(task.id)
        const isCollapsed = collapsedParents.has(task.id)
        const children = (node?.children || []).filter((c) => groupTaskIds.has(c.id))

        rows.push({
          type: 'task',
          task,
          rowIndex: currentRowIndex,
          depth: groupByMilestone ? 1 : 0,
          isParent: children.length > 0,
          isCollapsed,
          childCount: children.length,
          summaryStart: node?.summaryStart,
          summaryEnd: node?.summaryEnd,
        })
        processedIds.add(task.id)
        currentRowIndex++

        // Add children if not collapsed
        if (children.length > 0 && !isCollapsed) {
          children.forEach((child) => {
            rows.push({
              type: 'task',
              task: child,
              rowIndex: currentRowIndex,
              depth: groupByMilestone ? 2 : 1,
              isParent: false,
              isCollapsed: false,
              childCount: 0,
            })
            processedIds.add(child.id)
            currentRowIndex++
          })
        }
      })
    })

    return rows
  }, [taskGroups, groupByMilestone, taskTree, collapsedParents])

  const totalRows = rowData.length
  const chartHeight = totalRows * GANTT_CONFIG.ROW_HEIGHT

  // Find today's position for scroll
  const todayIndex = dates.findIndex((d) => isToday(d))

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

  // Today line position
  const todayX = todayIndex >= 0 ? dateToX(new Date(), startDate, dayWidth) : null

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-slate-200 overflow-hidden">
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
          <h2 className="text-sm font-medium text-slate-900">ガントチャート</h2>
          <span className="text-xs text-slate-500">
            {tasks.length} タスク
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Group by milestone toggle */}
          <button
            onClick={() => setGroupByMilestone(!groupByMilestone)}
            className={`p-1.5 rounded transition-colors ${
              groupByMilestone
                ? 'bg-slate-200 text-slate-900'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
            title={groupByMilestone ? 'フラット表示' : 'マイルストーン別'}
          >
            {groupByMilestone ? (
              <Rows className="w-4 h-4" />
            ) : (
              <ListBullets className="w-4 h-4" />
            )}
          </button>

          <div className="w-px h-4 bg-slate-200 mx-1" />

          {/* Zoom controls */}
          <button
            onClick={() => cycleViewMode('out')}
            disabled={viewMode === 'month'}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="縮小"
          >
            <MagnifyingGlassMinus className="w-4 h-4 text-slate-600" />
          </button>

          <span className="px-2 text-xs font-medium text-slate-600 min-w-[32px] text-center">
            {VIEW_MODE_CONFIG[viewMode].label}
          </span>

          <button
            onClick={() => cycleViewMode('in')}
            disabled={viewMode === 'day'}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="拡大"
          >
            <MagnifyingGlassPlus className="w-4 h-4 text-slate-600" />
          </button>

          <div className="w-px h-4 bg-slate-200 mx-2" />

          {/* Today button */}
          <button
            onClick={scrollToToday}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <CalendarBlank className="w-3.5 h-3.5" />
            今日
          </button>
        </div>
      </div>

      {/* Chart area - header row */}
      <div className="flex flex-shrink-0" style={{ height: GANTT_CONFIG.HEADER_HEIGHT }}>
        {/* Sidebar header */}
        <div
          className="flex-shrink-0 border-r border-b flex items-end px-3 pb-1"
          style={{
            width: GANTT_CONFIG.SIDEBAR_WIDTH,
            borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
            backgroundColor: GANTT_CONFIG.COLORS.HEADER_BG,
          }}
        >
          <span className="text-xs font-medium text-slate-500">タスク名</span>
        </div>

        {/* Date header */}
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
        {/* Sidebar */}
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
                  className="flex items-center px-3 bg-slate-50 border-b font-medium"
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
                    className="text-xs truncate"
                    style={{
                      color: row.milestone
                        ? GANTT_CONFIG.COLORS.MILESTONE
                        : GANTT_CONFIG.COLORS.TEXT_SECONDARY,
                    }}
                  >
                    {row.milestone?.name || 'マイルストーン未設定'}
                  </span>
                </div>
              )
            }

            const task = row.task!
            const isSelected = task.id === selectedTaskId
            const statusColors = getStatusBadge(task.status)
            const indentPx = 12 + row.depth * 16

            return (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task.id)}
                className="flex items-center gap-1.5 cursor-pointer transition-colors hover:bg-slate-50"
                style={{
                  height: GANTT_CONFIG.ROW_HEIGHT,
                  backgroundColor: isSelected ? '#F1F5F9' : undefined,
                  borderBottom: `0.5px solid ${GANTT_CONFIG.COLORS.GRID_LINE}`,
                  paddingLeft: indentPx,
                  paddingRight: 8,
                }}
              >
                {/* Collapse/expand toggle for parent tasks */}
                {row.isParent ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleCollapse(task.id)
                    }}
                    className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-slate-200 text-slate-500"
                  >
                    {row.isCollapsed ? (
                      <CaretRight className="w-3 h-3" weight="bold" />
                    ) : (
                      <CaretDown className="w-3 h-3" weight="bold" />
                    )}
                  </button>
                ) : (
                  <div className="flex-shrink-0 w-4" />
                )}

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

                {/* Task title */}
                <span
                  className="flex-1 truncate text-slate-900"
                  style={{
                    fontSize: GANTT_CONFIG.FONT.SIZE_SM,
                    fontWeight: row.isParent ? 500 : isSelected ? 500 : 400,
                  }}
                >
                  {task.title}
                </span>

                {/* Child count badge for parent tasks */}
                {row.isParent && (
                  <span className="px-1 py-0.5 rounded text-[9px] font-medium text-indigo-600 bg-indigo-50 flex-shrink-0">
                    {row.childCount}
                  </span>
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
              className="flex items-center justify-center text-slate-400"
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
          className="flex-1 overflow-auto"
          onScroll={(e) => {
            // Sync horizontal scroll with header
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollLeft = e.currentTarget.scrollLeft
            }
            // Sync vertical scroll with sidebar
            if (sidebarRef.current) {
              sidebarRef.current.scrollTop = e.currentTarget.scrollTop
            }
          }}
        >
          <div style={{ width: totalWidth, minHeight: '100%' }}>
            {/* Chart body */}
            <svg
              width={totalWidth}
              height={Math.max(chartHeight, 200)}
              className="block"
            >
              {/* Render rows */}
              {rowData.map((row) => {
                if (row.type === 'header') {
                  // Milestone header row
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
                    onClick={onTaskClick}
                    isSelected={task.id === selectedTaskId}
                    onDateChange={row.isParent ? undefined : onDateChange}
                    isParent={row.isParent}
                    summaryStart={row.summaryStart}
                    summaryEnd={row.summaryEnd}
                  />
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
            </svg>

            {/* Empty state */}
            {tasks.length === 0 && (
              <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
                タスクがありません
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div
        className="flex items-center gap-4 px-4 py-2 border-t text-xs text-slate-500 flex-shrink-0"
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
            className="w-3 h-1.5 rounded-sm"
            style={{ backgroundColor: GANTT_CONFIG.COLORS.PARENT_BAR }}
          />
          <span>親タスク</span>
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

// Status badge color helper
function getStatusBadge(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    backlog: { bg: '#F1F5F9', text: '#64748B' },
    todo: { bg: '#DBEAFE', text: '#1D4ED8' },
    in_progress: { bg: '#DCFCE7', text: '#15803D' },
    in_review: { bg: '#FEF3C7', text: '#B45309' },
    done: { bg: '#F1F5F9', text: '#64748B' },
    considering: { bg: '#FEF3C7', text: '#B45309' },
  }
  return colors[status] || colors.backlog
}

const statusLabels: Record<string, string> = {
  backlog: '未着手',
  todo: 'ToDo',
  in_progress: '進行中',
  in_review: 'レビュー中',
  done: '完了',
  considering: '検討中',
}
