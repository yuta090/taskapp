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
  onBarMove?: (taskId: string, newStart: string, newEnd: string) => void
  onLinkDragStart?: (taskId: string, mode: 'child' | 'parent', startX: number, startY: number) => void
  linkHighlight?: { type: 'eligible' | 'over'; mode: 'child' | 'parent' } | null
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
  onBarMove,
  onLinkDragStart,
  linkHighlight,
  isParent,
  summaryStart,
  summaryEnd,
}: GanttRowProps) {
  const [isHovering, setIsHovering] = useState(false)
  const [dragState, setDragState] = useState<{
    edge: 'start' | 'end' | 'move'
    startX: number
    originalX: number
    originalWidth: number
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ x: number; width: number } | null>(null)
  const dragPreviewRef = useRef<{ x: number; width: number } | null>(null)
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

  // Handle resize start (start/end edge)
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, edge: 'start' | 'end') => {
      e.stopPropagation()
      e.preventDefault()
      if (!barPosition || !onDateChange) return

      const preview = { x: barPosition.x, width: barPosition.width }
      setDragState({
        edge,
        startX: e.clientX,
        originalX: barPosition.x,
        originalWidth: barPosition.width,
      })
      setDragPreview(preview)
      dragPreviewRef.current = preview
    },
    [barPosition, onDateChange]
  )

  // Handle bar move start (middle area)
  const handleMoveMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!barPosition || !onBarMove) return

      const preview = { x: barPosition.x, width: barPosition.width }
      setDragState({
        edge: 'move',
        startX: e.clientX,
        originalX: barPosition.x,
        originalWidth: barPosition.width,
      })
      setDragPreview(preview)
      dragPreviewRef.current = preview
    },
    [barPosition, onBarMove]
  )

  // Snap to nearest day boundary
  const snapToGrid = useCallback((x: number): number => {
    return Math.round(x / dayWidth) * dayWidth
  }, [dayWidth])

  // Derived state: must be declared before useMemo/useEffect that reference them
  const displayPosition = dragPreview || barPosition
  const isDragging = dragState !== null

  // Tooltip text (uses state-based dragPreview, safe for render)
  const tooltipText = useMemo((): string => {
    if (isDragging && dragPreview) {
      if (dragState?.edge === 'move') {
        const s = xToDate(dragPreview.x, startDate, dayWidth).toLocaleDateString('ja-JP')
        const e = xToDate(dragPreview.x + dragPreview.width, startDate, dayWidth).toLocaleDateString('ja-JP')
        return `${s} ~ ${e}`
      }
      if (dragState?.edge === 'start') {
        return `開始: ${xToDate(dragPreview.x, startDate, dayWidth).toLocaleDateString('ja-JP')}`
      }
      if (dragState?.edge === 'end') {
        return `期限: ${xToDate(dragPreview.x + dragPreview.width, startDate, dayWidth).toLocaleDateString('ja-JP')}`
      }
    }
    return task.title.length > 18 ? task.title.slice(0, 18) + '...' : task.title
  }, [isDragging, dragPreview, dragState?.edge, startDate, dayWidth, task.title])

  // Global mouse move and up handlers for resize/move drag
  useEffect(() => {
    if (!dragState || !barPosition) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragState.startX
      let newPreview: { x: number; width: number }

      if (dragState.edge === 'move') {
        const snappedX = snapToGrid(dragState.originalX + deltaX)
        newPreview = { x: snappedX, width: dragState.originalWidth }
      } else if (dragState.edge === 'end') {
        const rawWidth = dragState.originalWidth + deltaX
        const snappedEndX = snapToGrid(dragState.originalX + rawWidth)
        const newWidth = Math.max(snappedEndX - dragState.originalX, dayWidth)
        newPreview = { x: dragState.originalX, width: newWidth }
      } else {
        const rawX = dragState.originalX + deltaX
        const snappedX = snapToGrid(rawX)
        const newWidth = Math.max(dragState.originalX + dragState.originalWidth - snappedX, dayWidth)
        newPreview = { x: snappedX, width: newWidth }
      }

      dragPreviewRef.current = newPreview
      setDragPreview(newPreview)
    }

    const handleMouseUp = () => {
      justFinishedDragRef.current = true
      setTimeout(() => { justFinishedDragRef.current = false }, 0)

      const preview = dragPreviewRef.current
      if (!preview) {
        setDragState(null)
        setDragPreview(null)
        dragPreviewRef.current = null
        return
      }

      if (dragState.edge === 'move' && onBarMove) {
        const newStart = xToDate(preview.x, startDate, dayWidth)
        const newEnd = xToDate(preview.x + preview.width, startDate, dayWidth)
        onBarMove(task.id, formatDateToLocalString(newStart), formatDateToLocalString(newEnd))
      } else if (dragState.edge === 'end' && onDateChange) {
        const endX = preview.x + preview.width
        const newDate = xToDate(endX, startDate, dayWidth)
        onDateChange(task.id, 'end', formatDateToLocalString(newDate))
      } else if (dragState.edge === 'start' && onDateChange) {
        const newDate = xToDate(preview.x, startDate, dayWidth)
        onDateChange(task.id, 'start', formatDateToLocalString(newDate))
      }

      setDragState(null)
      setDragPreview(null)
      dragPreviewRef.current = null
      setIsHovering(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, barPosition, onDateChange, onBarMove, task.id, startDate, dayWidth, snapToGrid])

  // Handle click - skip if we just finished dragging
  const handleClick = useCallback(() => {
    if (justFinishedDragRef.current) return
    onClick?.(task.id)
  }, [onClick, task.id])

  // Link handle mouse down
  const handleLinkMouseDown = useCallback(
    (e: React.MouseEvent, mode: 'child' | 'parent') => {
      e.stopPropagation()
      e.preventDefault()
      if (!onLinkDragStart || !barPosition) return

      // Get SVG coordinate for the handle center
      const handleX = mode === 'child'
        ? barPosition.x - 8
        : barPosition.x + barPosition.width + 8
      const handleY = y + GANTT_CONFIG.ROW_HEIGHT / 2

      onLinkDragStart(task.id, mode, handleX, handleY)
    },
    [onLinkDragStart, barPosition, task.id, y]
  )

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

      {/* Link highlight: row-wide glow for eligible targets */}
      {linkHighlight && linkHighlight.type === 'eligible' && (
        <rect
          x={0}
          y={y}
          width={totalWidth}
          height={GANTT_CONFIG.ROW_HEIGHT}
          fill={linkHighlight.mode === 'child' ? '#EEF2FF' : '#ECFDF5'}
          opacity={0.4}
        />
      )}
      {linkHighlight && linkHighlight.type === 'over' && (
        <rect
          x={0}
          y={y}
          width={totalWidth}
          height={GANTT_CONFIG.ROW_HEIGHT}
          fill={linkHighlight.mode === 'child' ? '#C7D2FE' : '#A7F3D0'}
          opacity={0.5}
        />
      )}

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
          <rect
            x={summaryBarPosition.x}
            y={y + GANTT_CONFIG.ROW_HEIGHT / 2 - 3}
            width={summaryBarPosition.width}
            height={6}
            rx={2}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR}
            opacity={0.7}
          />
          <rect
            x={summaryBarPosition.x}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={3}
            height={GANTT_CONFIG.BAR_HEIGHT}
            rx={1}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR}
            opacity={0.9}
          />
          <rect
            x={summaryBarPosition.x + summaryBarPosition.width - 3}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={3}
            height={GANTT_CONFIG.BAR_HEIGHT}
            rx={1}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR}
            opacity={0.9}
          />
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

      {/* Task bar */}
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

          {/* Bar glow when link-highlighted */}
          {linkHighlight && linkHighlight.type === 'over' && (
            <rect
              x={displayPosition.x - 2}
              y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING - 2}
              width={displayPosition.width + 4}
              height={GANTT_CONFIG.BAR_HEIGHT + 4}
              rx={GANTT_CONFIG.RADIUS.SM + 2}
              fill="none"
              stroke={linkHighlight.mode === 'child' ? '#6366F1' : '#10B981'}
              strokeWidth={2}
              opacity={0.8}
            />
          )}

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
              cursor: isDragging
                ? (dragState?.edge === 'move' ? 'grabbing' : 'ew-resize')
                : 'pointer',
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

          {/* Resize & move handles */}
          {(onDateChange || onBarMove) && (
            <>
              {/* Left resize handle (start date) - hit area */}
              {onDateChange && (
                <>
                  <rect
                    x={displayPosition.x - 4}
                    y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
                    width={12}
                    height={GANTT_CONFIG.BAR_HEIGHT}
                    fill="transparent"
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={(e) => handleResizeMouseDown(e, 'start')}
                  />
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
                </>
              )}

              {/* Middle move handle - transparent hit area between resize handles */}
              {onBarMove && displayPosition.width > 24 && (
                <rect
                  x={displayPosition.x + 12}
                  y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
                  width={Math.max(displayPosition.width - 24, 0)}
                  height={GANTT_CONFIG.BAR_HEIGHT}
                  fill="transparent"
                  style={{ cursor: isDragging && dragState?.edge === 'move' ? 'grabbing' : 'grab' }}
                  onMouseDown={handleMoveMouseDown}
                />
              )}

              {/* Right resize handle (end date) - hit area */}
              {onDateChange && (
                <>
                  <rect
                    x={displayPosition.x + displayPosition.width - 8}
                    y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
                    width={12}
                    height={GANTT_CONFIG.BAR_HEIGHT}
                    fill="transparent"
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={(e) => handleResizeMouseDown(e, 'end')}
                  />
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
            </>
          )}

          {/* Link handles - shown on hover, not during drag */}
          {isHovering && !isDragging && onLinkDragStart && (
            <>
              {/* Left handle: child mode (indigo) */}
              <circle
                cx={displayPosition.x - 8}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={5}
                fill="#6366F1"
                opacity={0.8}
                style={{ cursor: 'crosshair' }}
              />
              {/* Left handle hit area */}
              <circle
                cx={displayPosition.x - 8}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={10}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseDown={(e) => handleLinkMouseDown(e, 'child')}
              />

              {/* Right handle: parent mode (green) */}
              <circle
                cx={displayPosition.x + displayPosition.width + 8}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={5}
                fill="#10B981"
                opacity={0.8}
                style={{ cursor: 'crosshair' }}
              />
              {/* Right handle hit area */}
              <circle
                cx={displayPosition.x + displayPosition.width + 8}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={10}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseDown={(e) => handleLinkMouseDown(e, 'parent')}
              />
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
                {tooltipText}
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
