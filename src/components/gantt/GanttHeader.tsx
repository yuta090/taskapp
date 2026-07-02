'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { GANTT_CONFIG, type ViewMode } from '@/lib/gantt/constants'
import {
  getDatesInRange,
  formatDateLabel,
  formatMonthHeader,
  formatDateToLocalString,
  isWeekend,
  isToday,
  dateToX,
  xToDate,
} from '@/lib/gantt/dateUtils'
import type { Milestone } from '@/types/database'

interface GanttHeaderProps {
  startDate: Date
  endDate: Date
  viewMode: ViewMode
  dayWidth: number
  sidebarWidth: number
  milestones?: Milestone[]
  onMilestoneDateChange?: (milestoneId: string, startDate: string | null, dueDate: string | null) => void
}

/** Row height for each header section */
const MILESTONE_ROW_H = 24
const MONTH_ROW_H = 24
const DAY_ROW_H = 24

function getMilestoneColor(milestone: Milestone): { flag: string; text: string; bg: string } {
  if (milestone.completed_at) {
    return { flag: GANTT_CONFIG.COLORS.DONE, text: GANTT_CONFIG.COLORS.TEXT_SECONDARY, bg: GANTT_CONFIG.COLORS.WEEKEND }
  }
  if (!milestone.due_date) {
    return { flag: GANTT_CONFIG.COLORS.MILESTONE, text: GANTT_CONFIG.COLORS.MILESTONE, bg: GANTT_CONFIG.COLORS.MILESTONE_BG }
  }
  const daysLeft = Math.ceil((new Date(milestone.due_date).getTime() - Date.now()) / 86400000)
  if (daysLeft < 0) {
    return { flag: GANTT_CONFIG.COLORS.MILESTONE_PAST, text: GANTT_CONFIG.COLORS.MILESTONE_PAST, bg: GANTT_CONFIG.COLORS.MILESTONE_PAST_BG }
  }
  if (daysLeft <= 3) {
    return { flag: GANTT_CONFIG.COLORS.MILESTONE_URGENT, text: GANTT_CONFIG.COLORS.MILESTONE_URGENT, bg: GANTT_CONFIG.COLORS.MILESTONE_URGENT_BG }
  }
  if (daysLeft <= 7) {
    return { flag: GANTT_CONFIG.COLORS.MILESTONE_WARN, text: GANTT_CONFIG.COLORS.MILESTONE_WARN, bg: GANTT_CONFIG.COLORS.MILESTONE_WARN_BG }
  }
  return { flag: GANTT_CONFIG.COLORS.MILESTONE, text: GANTT_CONFIG.COLORS.MILESTONE, bg: GANTT_CONFIG.COLORS.MILESTONE_BG }
}

interface MilestoneDragState {
  milestoneId: string
  edge: 'start' | 'end' | 'move'
  originClientX: number
  originalStartX: number
  originalEndX: number
}

export function GanttHeader({
  startDate,
  endDate,
  viewMode,
  dayWidth,
  sidebarWidth,
  milestones = [],
  onMilestoneDateChange,
}: GanttHeaderProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragState, setDragState] = useState<MilestoneDragState | null>(null)
  const [dragPreview, setDragPreview] = useState<{ startX: number; endX: number } | null>(null)
  const dragStateRef = useRef<MilestoneDragState | null>(null)
  const dragPreviewRef = useRef<{ startX: number; endX: number } | null>(null)

  const dates = useMemo(
    () => getDatesInRange(startDate, endDate),
    [startDate, endDate]
  )

  // Group dates by month for header
  const months = useMemo(() => {
    const monthGroups: { month: string; startIndex: number; count: number }[] = []
    let currentMonth = ''
    let currentStartIndex = 0
    let currentCount = 0

    dates.forEach((date, index) => {
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`
      if (monthKey !== currentMonth) {
        if (currentMonth !== '') {
          monthGroups.push({
            month: formatMonthHeader(dates[currentStartIndex]),
            startIndex: currentStartIndex,
            count: currentCount,
          })
        }
        currentMonth = monthKey
        currentStartIndex = index
        currentCount = 1
      } else {
        currentCount++
      }
    })

    // Push last month
    if (currentCount > 0) {
      monthGroups.push({
        month: formatMonthHeader(dates[currentStartIndex]),
        startIndex: currentStartIndex,
        count: currentCount,
      })
    }

    return monthGroups
  }, [dates])

  // Compute milestone positions with range
  const milestoneMarkers = useMemo(() => {
    return milestones
      .filter((m) => m.due_date)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
      .map((m) => {
        const endX = dateToX(new Date(m.due_date!), startDate, dayWidth)
        const startX = m.start_date
          ? dateToX(new Date(m.start_date), startDate, dayWidth)
          : endX
        const colors = getMilestoneColor(m)
        return { milestone: m, startX, endX, colors }
      })
  }, [milestones, startDate, dayWidth])

  const totalWidth = dates.length * dayWidth
  const monthRowY = MILESTONE_ROW_H
  const dayRowY = MILESTONE_ROW_H + MONTH_ROW_H

  const canEdit = !!onMilestoneDateChange

  // --- Drag handlers ---
  const handleDragStart = useCallback(
    (e: React.MouseEvent, milestoneId: string, edge: 'start' | 'end' | 'move', sX: number, eX: number) => {
      if (!canEdit) return
      e.stopPropagation()
      e.preventDefault()
      const state: MilestoneDragState = {
        milestoneId,
        edge,
        originClientX: e.clientX,
        originalStartX: sX,
        originalEndX: eX,
      }
      dragStateRef.current = state
      dragPreviewRef.current = { startX: sX, endX: eX }
      setDragState(state)
      setDragPreview({ startX: sX, endX: eX })
    },
    [canEdit]
  )

  const isDragging = dragState !== null

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const ds = dragStateRef.current
      if (!ds) return
      const dx = e.clientX - ds.originClientX
      let newStartX = ds.originalStartX
      let newEndX = ds.originalEndX

      if (ds.edge === 'start') {
        newStartX = Math.min(ds.originalStartX + dx, ds.originalEndX - dayWidth)
      } else if (ds.edge === 'end') {
        newEndX = Math.max(ds.originalEndX + dx, ds.originalStartX + dayWidth)
      } else {
        // move both
        newStartX = ds.originalStartX + dx
        newEndX = ds.originalEndX + dx
      }

      const preview = { startX: newStartX, endX: newEndX }
      dragPreviewRef.current = preview
      setDragPreview(preview)
    }

    const handleMouseUp = () => {
      const ds = dragStateRef.current
      const preview = dragPreviewRef.current
      if (ds && preview && onMilestoneDateChange) {
        const newStartDate = xToDate(preview.startX, startDate, dayWidth)
        const newEndDate = xToDate(preview.endX, startDate, dayWidth)
        const startStr = formatDateToLocalString(newStartDate)
        const endStr = formatDateToLocalString(newEndDate)

        // Only fire if something changed
        const milestone = milestones.find((m) => m.id === ds.milestoneId)
        const origStart = milestone?.start_date || null
        const origEnd = milestone?.due_date || null
        if (startStr !== origStart || endStr !== origEnd) {
          onMilestoneDateChange(
            ds.milestoneId,
            ds.originalStartX < ds.originalEndX || ds.edge !== 'end' ? startStr : origStart,
            endStr,
          )
        }
      }

      dragStateRef.current = null
      dragPreviewRef.current = null
      setDragState(null)
      setDragPreview(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, onMilestoneDateChange, startDate, dayWidth, milestones])

  return (
    <div
      className="sticky top-0 z-20 flex"
      style={{ backgroundColor: GANTT_CONFIG.COLORS.HEADER_BG }}
    >
      {/* Sidebar spacer */}
      {sidebarWidth > 0 && (
        <div
          className="flex-shrink-0 border-r border-b"
          style={{
            width: sidebarWidth,
            height: GANTT_CONFIG.HEADER_HEIGHT,
            borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
          }}
        />
      )}

      {/* Date header */}
      <div className="relative overflow-hidden">
        <svg
          ref={svgRef}
          width={totalWidth}
          height={GANTT_CONFIG.HEADER_HEIGHT}
          className="block"
        >
          {/* Milestone indicator row (top) */}
          <g>
            <rect
              x={0}
              y={0}
              width={totalWidth}
              height={MILESTONE_ROW_H}
              fill={GANTT_CONFIG.COLORS.HEADER_BG}
            />
            {/* Separator line below milestone row */}
            <line
              x1={0}
              y1={MILESTONE_ROW_H - 0.5}
              x2={totalWidth}
              y2={MILESTONE_ROW_H - 0.5}
              stroke={GANTT_CONFIG.COLORS.GRID_LINE}
              strokeWidth={0.5}
              opacity={0.5}
            />
            {milestoneMarkers.map(({ milestone, startX: origStartX, endX: origEndX, colors }, idx) => {
              // Use drag preview if this milestone is being dragged
              const isDragTarget = dragState?.milestoneId === milestone.id
              const displayStartX = isDragTarget && dragPreview ? dragPreview.startX : origStartX
              const displayEndX = isDragTarget && dragPreview ? dragPreview.endX : origEndX

              const hasRange = displayStartX < displayEndX
              const labelText = milestone.name
              const estimatedLabelWidth = labelText.length * 8 + 16
              const barX = hasRange ? displayStartX : displayEndX - 2
              const barW = hasRange ? displayEndX - displayStartX : estimatedLabelWidth + 14

              // Find next milestone to compute available space
              const nextMarker = milestoneMarkers[idx + 1]
              const maxBarEnd = nextMarker ? nextMarker.startX - 8 : totalWidth
              const clampedBarW = isDragTarget ? barW : Math.min(barW, maxBarEnd - barX)

              return (
                <g key={milestone.id}>
                  {/* Background bar (always shown) */}
                  <rect
                    x={barX}
                    y={3}
                    width={Math.max(clampedBarW, 20)}
                    height={MILESTONE_ROW_H - 6}
                    rx={3}
                    fill={colors.flag}
                    opacity={isDragTarget ? 0.22 : 0.13}
                  />
                  {/* Start edge line */}
                  {hasRange && (
                    <line
                      x1={displayStartX}
                      y1={3}
                      x2={displayStartX}
                      y2={MILESTONE_ROW_H - 3}
                      stroke={colors.flag}
                      strokeWidth={1.5}
                      opacity={0.35}
                    />
                  )}
                  {/* End edge line (due_date) */}
                  <line
                    x1={displayEndX}
                    y1={3}
                    x2={displayEndX}
                    y2={MILESTONE_ROW_H - 3}
                    stroke={colors.flag}
                    strokeWidth={1.5}
                    opacity={0.5}
                  />
                  {/* Flag marker at due_date */}
                  <polygon
                    points={`${displayEndX},4 ${displayEndX + 6},8 ${displayEndX},12`}
                    fill={colors.flag}
                  />
                  {/* Label */}
                  <text
                    x={hasRange ? displayStartX + 5 : displayEndX + 9}
                    y={15}
                    fontSize={GANTT_CONFIG.FONT.SIZE_XS}
                    fontWeight={600}
                    fill={colors.text}
                    style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
                  >
                    {labelText}
                  </text>

                  {/* Drag handles (only if editable) */}
                  {canEdit && hasRange && (
                    <>
                      {/* Start edge drag handle */}
                      <rect
                        x={displayStartX - 4}
                        y={1}
                        width={10}
                        height={MILESTONE_ROW_H - 2}
                        fill="transparent"
                        style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => handleDragStart(e, milestone.id, 'start', origStartX, origEndX)}
                      />
                      {/* Move handle (middle) */}
                      <rect
                        x={displayStartX + 6}
                        y={1}
                        width={Math.max(displayEndX - displayStartX - 12, 0)}
                        height={MILESTONE_ROW_H - 2}
                        fill="transparent"
                        style={{ cursor: isDragTarget ? 'grabbing' : 'grab' }}
                        onMouseDown={(e) => handleDragStart(e, milestone.id, 'move', origStartX, origEndX)}
                      />
                    </>
                  )}
                  {/* End edge drag handle (always, even without start_date) */}
                  {canEdit && (
                    <rect
                      x={displayEndX - 4}
                      y={1}
                      width={10}
                      height={MILESTONE_ROW_H - 2}
                      fill="transparent"
                      style={{ cursor: 'ew-resize' }}
                      onMouseDown={(e) => handleDragStart(e, milestone.id, 'end', origStartX, origEndX)}
                    />
                  )}
                </g>
              )
            })}
          </g>

          {/* Month row */}
          <g>
            {months.map((monthGroup, i) => {
              const x = monthGroup.startIndex * dayWidth
              const width = monthGroup.count * dayWidth

              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={monthRowY}
                    width={width}
                    height={MONTH_ROW_H}
                    fill={GANTT_CONFIG.COLORS.HEADER_BG}
                  />
                  <text
                    x={x + 8}
                    y={monthRowY + 16}
                    fontSize={GANTT_CONFIG.FONT.SIZE_SM}
                    fontWeight={500}
                    fill={GANTT_CONFIG.COLORS.TEXT_SECONDARY}
                    style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
                  >
                    {monthGroup.month}
                  </text>
                  {/* Month separator */}
                  {i > 0 && (
                    <line
                      x1={x}
                      y1={monthRowY}
                      x2={x}
                      y2={GANTT_CONFIG.HEADER_HEIGHT}
                      stroke={GANTT_CONFIG.COLORS.GRID_LINE}
                      strokeWidth={1}
                    />
                  )}
                </g>
              )
            })}
          </g>

          {/* Day row */}
          <g>
            {dates.map((date, i) => {
              const x = i * dayWidth
              const weekend = isWeekend(date)
              const today = isToday(date)

              return (
                <g key={i}>
                  {/* Weekend background */}
                  {weekend && (
                    <rect
                      x={x}
                      y={dayRowY}
                      width={dayWidth}
                      height={DAY_ROW_H}
                      fill={GANTT_CONFIG.COLORS.WEEKEND}
                    />
                  )}

                  {/* Today highlight */}
                  {today && (
                    <rect
                      x={x}
                      y={dayRowY}
                      width={dayWidth}
                      height={DAY_ROW_H}
                      fill="#FEE2E2"
                    />
                  )}

                  {/* Day label */}
                  {(viewMode === 'day' || date.getDate() === 1 || date.getDay() === 1) && (
                    <text
                      x={x + dayWidth / 2}
                      y={dayRowY + 16}
                      fontSize={GANTT_CONFIG.FONT.SIZE_XS}
                      fontWeight={today ? 600 : 400}
                      fill={
                        today
                          ? GANTT_CONFIG.COLORS.TODAY
                          : weekend
                          ? GANTT_CONFIG.COLORS.TEXT_MUTED
                          : GANTT_CONFIG.COLORS.TEXT_SECONDARY
                      }
                      textAnchor="middle"
                      style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
                    >
                      {formatDateLabel(date, viewMode)}
                    </text>
                  )}

                  {/* Grid line */}
                  <line
                    x1={x}
                    y1={dayRowY}
                    x2={x}
                    y2={GANTT_CONFIG.HEADER_HEIGHT}
                    stroke={GANTT_CONFIG.COLORS.GRID_LINE}
                    strokeWidth={0.5}
                    opacity={0.5}
                  />
                </g>
              )
            })}
          </g>

          {/* Bottom border */}
          <line
            x1={0}
            y1={GANTT_CONFIG.HEADER_HEIGHT - 0.5}
            x2={totalWidth}
            y2={GANTT_CONFIG.HEADER_HEIGHT - 0.5}
            stroke={GANTT_CONFIG.COLORS.GRID_LINE}
            strokeWidth={1}
          />
        </svg>
      </div>
    </div>
  )
}
