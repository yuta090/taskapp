'use client'

import { useMemo, useState, useRef, useCallback } from 'react'
import {
  CalendarBlank,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ListBullets,
  Rows,
} from '@phosphor-icons/react'
import { GANTT_CONFIG, VIEW_MODE_CONFIG, type ViewMode } from '@/lib/gantt/constants'
import {
  calcDateRange,
  getDatesInRange,
  isToday,
  dateToX,
} from '@/lib/gantt/dateUtils'
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
}

interface TaskGroup {
  milestone: Milestone | null
  tasks: Task[]
}

export function GanttChart({
  tasks,
  milestones,
  riskForecasts,
  selectedTaskId,
  onTaskClick,
  onDateChange,
}: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [groupByMilestone, setGroupByMilestone] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

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

  // Calculate total rows including group headers
  const totalRows = useMemo(() => {
    if (!groupByMilestone) return tasks.length
    return taskGroups.reduce((sum, group) => sum + group.tasks.length + 1, 0) // +1 for header
  }, [taskGroups, groupByMilestone, tasks.length])

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

  // Build row index map
  let currentRowIndex = 0
  const rowData: Array<{ type: 'header' | 'task'; milestone?: Milestone | null; task?: Task; rowIndex: number }> = []

  taskGroups.forEach((group) => {
    if (groupByMilestone) {
      rowData.push({ type: 'header', milestone: group.milestone, rowIndex: currentRowIndex })
      currentRowIndex++
    }
    group.tasks.forEach((task) => {
      rowData.push({ type: 'task', task, rowIndex: currentRowIndex })
      currentRowIndex++
    })
  })

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
          {/* Group by milestone toggle */}
          <button
            onClick={() => setGroupByMilestone(!groupByMilestone)}
            className={`p-1.5 rounded transition-colors ${
              groupByMilestone
                ? 'bg-gray-200 text-gray-900'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            title={groupByMilestone ? 'フラット表示' : 'マイルストーン別'}
          >
            {groupByMilestone ? (
              <Rows className="w-4 h-4" />
            ) : (
              <ListBullets className="w-4 h-4" />
            )}
          </button>

          <div className="w-px h-4 bg-gray-200 mx-1" />

          {/* Zoom controls */}
          <button
            onClick={() => cycleViewMode('out')}
            disabled={viewMode === 'month'}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="縮小"
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
          >
            <MagnifyingGlassPlus className="w-4 h-4 text-gray-600" />
          </button>

          <div className="w-px h-4 bg-gray-200 mx-2" />

          {/* Today button */}
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
        {/* Sidebar header */}
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
                  {/* Risk badge in sidebar */}
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

            return (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task.id)}
                className="flex items-center gap-2 px-3 cursor-pointer transition-colors hover:bg-gray-50"
                style={{
                  height: GANTT_CONFIG.ROW_HEIGHT,
                  backgroundColor: isSelected ? '#F1F5F9' : undefined,
                  borderBottom: `0.5px solid ${GANTT_CONFIG.COLORS.GRID_LINE}`,
                  paddingLeft: groupByMilestone ? 24 : 12,
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

                {/* Task title */}
                <span
                  className="flex-1 truncate text-gray-900"
                  style={{
                    fontSize: GANTT_CONFIG.FONT.SIZE_SM,
                    fontWeight: isSelected ? 500 : 400,
                  }}
                >
                  {task.title}
                </span>

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
                    onDateChange={onDateChange}
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

// Status badge color helper
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
