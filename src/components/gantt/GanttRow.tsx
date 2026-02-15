'use client'

import { useMemo, useState, useCallback, useEffect, useRef, memo } from 'react'
import { GANTT_CONFIG } from '@/lib/gantt/constants'
import { getTaskBarPosition, isWeekend, getDatesInRange, xToDate, formatDateToLocalString, dateToX } from '@/lib/gantt/dateUtils'
import type { Task } from '@/types/database'

interface GanttRowProps {
  task: Task
  startDate: Date
  endDate: Date
  dayWidth: number
  rowIndex: number
  onClick?: (taskId: string) => void
  isSelected?: boolean
  onDateChange?: (taskId: string, field: 'start' | 'end', newDate: string) => void
  /** Parent task with summary bar */
  isParent?: boolean
  /** Summary start date (auto-computed from children) */
  summaryStart?: string | null
  /** Summary end date (auto-computed from children) */
  summaryEnd?: string | null
}

export const GanttRow = memo(function GanttRow({
  task,
  startDate,
  endDate,
  dayWidth,
  rowIndex,
  onClick,
  isSelected,
  onDateChange,
  isParent,
  summaryStart,
  summaryEnd,
}: GanttRowProps) {
  const [isHovering, setIsHovering] = useState(false)
  const [dragState, setDragState] = useState<{
    edge: 'start' | 'end'
    startX: number
    originalX: number
    originalWidth: number
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ x: number; width: number } | null>(null)
  const justFinishedDragRef = useRef(false)

  const dates = useMemo(
    () => getDatesInRange(startDate, endDate),
    [startDate, endDate]
  )

  const barPosition = useMemo(
    () => getTaskBarPosition(task, startDate, dayWidth),
    [task, startDate, dayWidth]
  )

  // Compute summary bar position for parent tasks
  const summaryBarPosition = useMemo(() => {
    if (!isParent || (!summaryStart && !summaryEnd)) return null

    const start = summaryStart ? new Date(summaryStart) : null
    const end = summaryEnd ? new Date(summaryEnd) : null

    if (!start && !end) return null

    if (start && end) {
      const x = dateToX(start, startDate, dayWidth)
      const endX = dateToX(end, startDate, dayWidth)
      return { x, width: Math.max(endX - x, 4) }
    }

    if (start) {
      const x = dateToX(start, startDate, dayWidth)
      return { x, width: Math.max(dayWidth, 4) }
    }

    if (end) {
      const endX = dateToX(end, startDate, dayWidth)
      // Position at the end date rather than stretching from x=0
      return { x: Math.max(endX - dayWidth, 0), width: dayWidth }
    }

    return null
  }, [isParent, summaryStart, summaryEnd, startDate, dayWidth])

  const totalWidth = dates.length * dayWidth
  const y = rowIndex * GANTT_CONFIG.ROW_HEIGHT

  // Determine bar color based on ball ownership and status
  const getBarColor = () => {
    if (task.status === 'done') return GANTT_CONFIG.COLORS.DONE
    if (task.ball === 'client') return GANTT_CONFIG.COLORS.CLIENT
    return GANTT_CONFIG.COLORS.INTERNAL
  }

  const barColor = getBarColor()

  const handleBarMouseEnter = useCallback(() => {
    setIsHovering(true)
  }, [])

  const handleBarMouseLeave = useCallback(() => {
    if (!dragState) {
      setIsHovering(false)
    }
  }, [dragState])

  // Handle resize start
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, edge: 'start' | 'end') => {
      e.stopPropagation()
      e.preventDefault()
      if (!barPosition || !onDateChange) return

      setDragState({
        edge,
        startX: e.clientX,
        originalX: barPosition.x,
        originalWidth: barPosition.width,
      })
      setDragPreview({ x: barPosition.x, width: barPosition.width })
    },
    [barPosition, onDateChange]
  )

  // Snap to nearest day boundary
  const snapToGrid = useCallback((x: number): number => {
    return Math.round(x / dayWidth) * dayWidth
  }, [dayWidth])

  // Global mouse move and up handlers
  useEffect(() => {
    if (!dragState || !barPosition) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragState.startX

      if (dragState.edge === 'end') {
        // Dragging end: change width, snap to grid
        const rawWidth = dragState.originalWidth + deltaX
        const snappedEndX = snapToGrid(dragState.originalX + rawWidth)
        const newWidth = Math.max(snappedEndX - dragState.originalX, dayWidth)
        setDragPreview({ x: dragState.originalX, width: newWidth })
      } else {
        // Dragging start: change x and width inversely, snap to grid
        const rawX = dragState.originalX + deltaX
        const snappedX = snapToGrid(rawX)
        const newWidth = Math.max(dragState.originalX + dragState.originalWidth - snappedX, dayWidth)
        setDragPreview({ x: snappedX, width: newWidth })
      }
    }

    const handleMouseUp = () => {
      // Mark that we just finished dragging to prevent click from firing
      justFinishedDragRef.current = true
      // Reset the flag after a short delay (after click event would fire)
      setTimeout(() => {
        justFinishedDragRef.current = false
      }, 0)

      if (!dragPreview || !onDateChange) {
        setDragState(null)
        setDragPreview(null)
        return
      }

      // Calculate new date based on drag position (using local timezone)
      if (dragState.edge === 'end') {
        const endX = dragPreview.x + dragPreview.width
        const newDate = xToDate(endX, startDate, dayWidth)
        const dateStr = formatDateToLocalString(newDate)
        onDateChange(task.id, 'end', dateStr)
      } else {
        const newDate = xToDate(dragPreview.x, startDate, dayWidth)
        const dateStr = formatDateToLocalString(newDate)
        onDateChange(task.id, 'start', dateStr)
      }

      setDragState(null)
      setDragPreview(null)
      setIsHovering(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, dragPreview, barPosition, onDateChange, task.id, startDate, dayWidth, snapToGrid])

  // Use preview position if dragging, otherwise use calculated position
  const displayPosition = dragPreview || barPosition
  const isDragging = dragState !== null

  // Handle click - skip if we just finished dragging
  const handleClick = useCallback(() => {
    if (justFinishedDragRef.current) {
      return
    }
    onClick?.(task.id)
  }, [onClick, task.id])

  return (
    <g
      className="gantt-row cursor-pointer"
      onClick={handleClick}
      style={{
        transition: isDragging ? 'none' : `opacity ${GANTT_CONFIG.TRANSITION.DURATION} ${GANTT_CONFIG.TRANSITION.EASING}`,
      }}
    >
      {/* Row background */}
      <rect
        x={0}
        y={y}
        width={totalWidth}
        height={GANTT_CONFIG.ROW_HEIGHT}
        fill={isSelected ? '#F1F5F9' : 'transparent'}
        className="hover:fill-gray-50"
      />

      {/* Weekend backgrounds */}
      {dates.map((date, i) => {
        if (!isWeekend(date)) return null
        return (
          <rect
            key={i}
            x={i * dayWidth}
            y={y}
            width={dayWidth}
            height={GANTT_CONFIG.ROW_HEIGHT}
            fill={GANTT_CONFIG.COLORS.WEEKEND}
            opacity={0.5}
          />
        )
      })}

      {/* Grid lines */}
      {dates.map((_, i) => (
        <line
          key={i}
          x1={i * dayWidth}
          y1={y}
          x2={i * dayWidth}
          y2={y + GANTT_CONFIG.ROW_HEIGHT}
          stroke={GANTT_CONFIG.COLORS.GRID_LINE}
          strokeWidth={0.5}
          opacity={0.3}
        />
      ))}

      {/* Bottom border */}
      <line
        x1={0}
        y1={y + GANTT_CONFIG.ROW_HEIGHT - 0.5}
        x2={totalWidth}
        y2={y + GANTT_CONFIG.ROW_HEIGHT - 0.5}
        stroke={GANTT_CONFIG.COLORS.GRID_LINE}
        strokeWidth={0.5}
        opacity={0.5}
      />

      {/* Parent summary bar (thin bar showing child date range) */}
      {isParent && summaryBarPosition && (
        <g onMouseEnter={handleBarMouseEnter} onMouseLeave={handleBarMouseLeave}>
          {/* Summary bar background */}
          <rect
            x={summaryBarPosition.x}
            y={y + GANTT_CONFIG.ROW_HEIGHT / 2 - 3}
            width={summaryBarPosition.width}
            height={6}
            rx={2}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR}
            opacity={0.7}
          />
          {/* Start cap */}
          <rect
            x={summaryBarPosition.x}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={3}
            height={GANTT_CONFIG.BAR_HEIGHT}
            rx={1}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR}
            opacity={0.9}
          />
          {/* End cap */}
          <rect
            x={summaryBarPosition.x + summaryBarPosition.width - 3}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={3}
            height={GANTT_CONFIG.BAR_HEIGHT}
            rx={1}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR}
            opacity={0.9}
          />

          {/* Summary tooltip on hover */}
          {isHovering && (
            <g>
              <rect
                x={summaryBarPosition.x}
                y={y - 28}
                width={180}
                height={24}
                rx={4}
                fill="#1E293B"
                opacity={0.95}
              />
              <text
                x={summaryBarPosition.x + 8}
                y={y - 12}
                fontSize={11}
                fill="white"
                style={{ fontFamily: 'inherit' }}
              >
                {summaryStart && summaryEnd
                  ? `${new Date(summaryStart).toLocaleDateString('ja-JP')} ~ ${new Date(summaryEnd).toLocaleDateString('ja-JP')}`
                  : '子タスクのサマリー'}
              </text>
            </g>
          )}
        </g>
      )}

      {/* Task bar (for non-parent tasks, or parent's own bar if it has dates) */}
      {!isParent && displayPosition && (
        <g
          onMouseEnter={handleBarMouseEnter}
          onMouseLeave={handleBarMouseLeave}
        >
          {/* Bar shadow */}
          <rect
            x={displayPosition.x}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + 1}
            width={displayPosition.width}
            height={GANTT_CONFIG.BAR_HEIGHT}
            rx={GANTT_CONFIG.RADIUS.SM}
            fill="black"
            opacity={0.05}
          />

          {/* Bar */}
          <rect
            x={displayPosition.x}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={displayPosition.width}
            height={GANTT_CONFIG.BAR_HEIGHT}
            rx={GANTT_CONFIG.RADIUS.SM}
            fill={barColor}
            className="transition-all duration-150"
            style={{
              filter: isSelected ? 'brightness(0.9)' : undefined,
              cursor: isDragging ? 'ew-resize' : 'pointer',
              opacity: isDragging ? 0.8 : 1,
            }}
          />

          {/* Progress indicator for in_progress tasks */}
          {task.status === 'in_progress' && displayPosition.width > 20 && (
            <rect
              x={displayPosition.x}
              y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
              width={displayPosition.width * 0.5}
              height={GANTT_CONFIG.BAR_HEIGHT}
              rx={GANTT_CONFIG.RADIUS.SM}
              fill={barColor}
              opacity={0.3}
            />
          )}

          {/* Ball indicator dot */}
          {task.ball === 'client' && (
            <circle
              cx={displayPosition.x + displayPosition.width - 8}
              cy={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + GANTT_CONFIG.BAR_HEIGHT / 2}
              r={3}
              fill="white"
              opacity={0.9}
            />
          )}

          {/* Resize handles - hit areas always present for immediate cursor change */}
          {onDateChange && (
            <>
              {/* Left resize handle (start date) - hit area */}
              <rect
                x={displayPosition.x - 4}
                y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
                width={12}
                height={GANTT_CONFIG.BAR_HEIGHT}
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => handleResizeMouseDown(e, 'start')}
              />
              {/* Left handle visual indicator - only on hover */}
              {(isHovering || isDragging) && (
                <rect
                  x={displayPosition.x + 2}
                  y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + 4}
                  width={3}
                  height={GANTT_CONFIG.BAR_HEIGHT - 8}
                  rx={1}
                  fill="white"
                  opacity={0.9}
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {/* Right resize handle (end date) - hit area */}
              <rect
                x={displayPosition.x + displayPosition.width - 8}
                y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
                width={12}
                height={GANTT_CONFIG.BAR_HEIGHT}
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => handleResizeMouseDown(e, 'end')}
              />
              {/* Right handle visual indicator - only on hover */}
              {(isHovering || isDragging) && (
                <rect
                  x={displayPosition.x + displayPosition.width - 5}
                  y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + 4}
                  width={3}
                  height={GANTT_CONFIG.BAR_HEIGHT - 8}
                  rx={1}
                  fill="white"
                  opacity={0.9}
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </>
          )}

          {/* Date tooltip on hover/drag */}
          {(isHovering || isDragging) && (
            <g>
              <rect
                x={displayPosition.x}
                y={y - 28}
                width={Math.max(displayPosition.width, 140)}
                height={24}
                rx={4}
                fill="#1E293B"
                opacity={0.95}
              />
              <text
                x={displayPosition.x + 8}
                y={y - 12}
                fontSize={11}
                fill="white"
                style={{ fontFamily: 'inherit' }}
              >
                {isDragging && dragState?.edge === 'start' && dragPreview
                  ? `開始: ${xToDate(dragPreview.x, startDate, dayWidth).toLocaleDateString('ja-JP')}`
                  : isDragging && dragState?.edge === 'end' && dragPreview
                  ? `期限: ${xToDate(dragPreview.x + dragPreview.width, startDate, dayWidth).toLocaleDateString('ja-JP')}`
                  : task.title.length > 18
                  ? task.title.slice(0, 18) + '...'
                  : task.title}
              </text>
            </g>
          )}
        </g>
      )}

      {/* No dates indicator */}
      {!isParent && !displayPosition && (
        <text
          x={8}
          y={y + GANTT_CONFIG.ROW_HEIGHT / 2 + 4}
          fontSize={GANTT_CONFIG.FONT.SIZE_XS}
          fill={GANTT_CONFIG.COLORS.TEXT_MUTED}
          style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
        >
          期日未設定
        </text>
      )}

      {/* Parent with no summary dates */}
      {isParent && !summaryBarPosition && (
        <text
          x={8}
          y={y + GANTT_CONFIG.ROW_HEIGHT / 2 + 4}
          fontSize={GANTT_CONFIG.FONT.SIZE_XS}
          fill={GANTT_CONFIG.COLORS.TEXT_MUTED}
          style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
        >
          子タスクの期日未設定
        </text>
      )}
    </g>
  )
})
