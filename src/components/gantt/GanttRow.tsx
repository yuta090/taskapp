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

  const getBarColor = () => {
    if (task.status === 'done') return GANTT_CONFIG.COLORS.DONE
    if (task.ball === 'client') return GANTT_CONFIG.COLORS.CLIENT
    return GANTT_CONFIG.COLORS.INTERNAL
  }
  const barColor = getBarColor()

  // Derived state
  const displayPosition = dragPreview || barPosition
  const isDragging = dragState !== null

  // Handle resize start (start/end edge)
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, edge: 'start' | 'end') => {
      e.stopPropagation()
      e.preventDefault()
      if (!barPosition || !onDateChange) return
      const preview = { x: barPosition.x, width: barPosition.width }
      setDragState({ edge, startX: e.clientX, originalX: barPosition.x, originalWidth: barPosition.width })
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
      setDragState({ edge: 'move', startX: e.clientX, originalX: barPosition.x, originalWidth: barPosition.width })
      setDragPreview(preview)
      dragPreviewRef.current = preview
    },
    [barPosition, onBarMove]
  )

  // Snap to nearest day boundary
  const snapToGrid = useCallback((x: number): number => {
    return Math.round(x / dayWidth) * dayWidth
  }, [dayWidth])

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
      const preview = dragPreviewRef.current
      if (preview) {
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
      }

      // Always clean up
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

  // Link handle mouse down
  const handleLinkMouseDown = useCallback(
    (e: React.MouseEvent, mode: 'child' | 'parent') => {
      e.stopPropagation()
      e.preventDefault()
      if (!onLinkDragStart || !barPosition) return
      const handleX = mode === 'child'
        ? barPosition.x - 12
        : barPosition.x + barPosition.width + 12
      const handleY = y + GANTT_CONFIG.ROW_HEIGHT / 2
      onLinkDragStart(task.id, mode, handleX, handleY)
    },
    [onLinkDragStart, barPosition, task.id, y]
  )

  // Bar area dimensions for hover hit zone (extends beyond bar for link handles)
  const barHitPadding = 16

  return (
    <g className="gantt-row">
      {/* Row background */}
      <rect
        x={0}
        y={y}
        width={totalWidth}
        height={GANTT_CONFIG.ROW_HEIGHT}
        fill={isSelected ? '#F1F5F9' : 'transparent'}
      />

      {/* Link highlight: row-wide glow for eligible targets */}
      {linkHighlight && linkHighlight.type === 'eligible' && (
        <rect
          x={0} y={y} width={totalWidth} height={GANTT_CONFIG.ROW_HEIGHT}
          fill={linkHighlight.mode === 'child' ? '#EEF2FF' : '#ECFDF5'}
          opacity={0.4}
        />
      )}
      {linkHighlight && linkHighlight.type === 'over' && (
        <rect
          x={0} y={y} width={totalWidth} height={GANTT_CONFIG.ROW_HEIGHT}
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
            x={i * dayWidth} y={y}
            width={dayWidth} height={GANTT_CONFIG.ROW_HEIGHT}
            fill={GANTT_CONFIG.COLORS.WEEKEND}
            opacity={0.5}
          />
        )
      })}

      {/* Grid lines */}
      {dates.map((_, i) => (
        <line
          key={i}
          x1={i * dayWidth} y1={y}
          x2={i * dayWidth} y2={y + GANTT_CONFIG.ROW_HEIGHT}
          stroke={GANTT_CONFIG.COLORS.GRID_LINE}
          strokeWidth={0.5} opacity={0.3}
        />
      ))}

      {/* Bottom border */}
      <line
        x1={0} y1={y + GANTT_CONFIG.ROW_HEIGHT - 0.5}
        x2={totalWidth} y2={y + GANTT_CONFIG.ROW_HEIGHT - 0.5}
        stroke={GANTT_CONFIG.COLORS.GRID_LINE}
        strokeWidth={0.5} opacity={0.5}
      />

      {/* Parent summary bar */}
      {isParent && summaryBarPosition && (
        <g>
          <rect
            x={summaryBarPosition.x}
            y={y + GANTT_CONFIG.ROW_HEIGHT / 2 - 3}
            width={summaryBarPosition.width} height={6} rx={2}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR} opacity={0.7}
          />
          <rect
            x={summaryBarPosition.x}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={3} height={GANTT_CONFIG.BAR_HEIGHT} rx={1}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR} opacity={0.9}
          />
          <rect
            x={summaryBarPosition.x + summaryBarPosition.width - 3}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={3} height={GANTT_CONFIG.BAR_HEIGHT} rx={1}
            fill={GANTT_CONFIG.COLORS.PARENT_BAR} opacity={0.9}
          />
        </g>
      )}

      {/* Task bar - NO onClick (task opening is sidebar only) */}
      {!isParent && displayPosition && (
        <g>
          {/* Hover hit area - extends beyond bar to cover link handle zones */}
          <rect
            x={displayPosition.x - barHitPadding}
            y={y}
            width={displayPosition.width + barHitPadding * 2}
            height={GANTT_CONFIG.ROW_HEIGHT}
            fill="transparent"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => { if (!isDragging) setIsHovering(false) }}
            style={{ cursor: isDragging
              ? (dragState?.edge === 'move' ? 'grabbing' : 'ew-resize')
              : 'default' }}
          />

          {/* Bar shadow */}
          <rect
            x={displayPosition.x}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + 1}
            width={displayPosition.width} height={GANTT_CONFIG.BAR_HEIGHT}
            rx={GANTT_CONFIG.RADIUS.SM}
            fill="black" opacity={0.05}
            style={{ pointerEvents: 'none' }}
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
              strokeWidth={2} opacity={0.8}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Bar body */}
          <rect
            x={displayPosition.x}
            y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
            width={displayPosition.width} height={GANTT_CONFIG.BAR_HEIGHT}
            rx={GANTT_CONFIG.RADIUS.SM}
            fill={barColor}
            style={{
              filter: isSelected ? 'brightness(0.9)' : undefined,
              opacity: isDragging ? 0.8 : 1,
              pointerEvents: 'none',
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
              fill={barColor} opacity={0.3}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Ball indicator dot */}
          {task.ball === 'client' && (
            <circle
              cx={displayPosition.x + displayPosition.width - 8}
              cy={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + GANTT_CONFIG.BAR_HEIGHT / 2}
              r={3} fill="white" opacity={0.9}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* === Interactive handles (layered on top of bar) === */}

          {/* Left resize handle (start date) */}
          {onDateChange && (
            <rect
              x={displayPosition.x - 4}
              y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
              width={12} height={GANTT_CONFIG.BAR_HEIGHT}
              fill="transparent"
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => handleResizeMouseDown(e, 'start')}
            />
          )}

          {/* Middle move handle */}
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

          {/* Right resize handle (end date) */}
          {onDateChange && (
            <rect
              x={displayPosition.x + displayPosition.width - 8}
              y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING}
              width={12} height={GANTT_CONFIG.BAR_HEIGHT}
              fill="transparent"
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => handleResizeMouseDown(e, 'end')}
            />
          )}

          {/* Visual resize indicators (hover only, no pointer events) */}
          {(isHovering || isDragging) && onDateChange && (
            <>
              <rect
                x={displayPosition.x + 2}
                y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + 4}
                width={3} height={GANTT_CONFIG.BAR_HEIGHT - 8} rx={1}
                fill="white" opacity={0.9}
                style={{ pointerEvents: 'none' }}
              />
              <rect
                x={displayPosition.x + displayPosition.width - 5}
                y={y + GANTT_CONFIG.BAR_VERTICAL_PADDING + 4}
                width={3} height={GANTT_CONFIG.BAR_HEIGHT - 8} rx={1}
                fill="white" opacity={0.9}
                style={{ pointerEvents: 'none' }}
              />
            </>
          )}

          {/* Link handles - visible on hover, not during resize/move drag */}
          {isHovering && !isDragging && onLinkDragStart && (
            <>
              {/* Left handle: "この子にする" (indigo) */}
              <circle
                cx={displayPosition.x - 12}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={7} fill="#6366F1" opacity={0.85}
                style={{ pointerEvents: 'none' }}
              />
              <text
                x={displayPosition.x - 12}
                y={y + GANTT_CONFIG.ROW_HEIGHT / 2 + 1}
                fontSize={8} fill="white" fontWeight={700}
                textAnchor="middle" dominantBaseline="middle"
                style={{ pointerEvents: 'none' }}
              >
                子
              </text>
              {/* Left handle hit area */}
              <circle
                cx={displayPosition.x - 12}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={12} fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseDown={(e) => handleLinkMouseDown(e, 'child')}
              />

              {/* Right handle: "この親にする" (green) */}
              <circle
                cx={displayPosition.x + displayPosition.width + 12}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={7} fill="#10B981" opacity={0.85}
                style={{ pointerEvents: 'none' }}
              />
              <text
                x={displayPosition.x + displayPosition.width + 12}
                y={y + GANTT_CONFIG.ROW_HEIGHT / 2 + 1}
                fontSize={8} fill="white" fontWeight={700}
                textAnchor="middle" dominantBaseline="middle"
                style={{ pointerEvents: 'none' }}
              >
                親
              </text>
              {/* Right handle hit area */}
              <circle
                cx={displayPosition.x + displayPosition.width + 12}
                cy={y + GANTT_CONFIG.ROW_HEIGHT / 2}
                r={12} fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseDown={(e) => handleLinkMouseDown(e, 'parent')}
              />
            </>
          )}

          {/* Tooltip on hover/drag */}
          {(isHovering || isDragging) && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={displayPosition.x}
                y={y - 28}
                width={Math.max(displayPosition.width, 140)}
                height={24} rx={4}
                fill="#1E293B" opacity={0.95}
              />
              <text
                x={displayPosition.x + 8}
                y={y - 12}
                fontSize={11} fill="white"
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
          x={8} y={y + GANTT_CONFIG.ROW_HEIGHT / 2 + 4}
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
          x={8} y={y + GANTT_CONFIG.ROW_HEIGHT / 2 + 4}
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
