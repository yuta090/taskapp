'use client'

import { useMemo } from 'react'
import { GANTT_CONFIG, type ViewMode } from '@/lib/gantt/constants'
import {
  getDatesInRange,
  formatDateLabel,
  formatMonthHeader,
  isWeekend,
  isToday,
} from '@/lib/gantt/dateUtils'

interface GanttHeaderProps {
  startDate: Date
  endDate: Date
  viewMode: ViewMode
  dayWidth: number
  sidebarWidth: number
}

export function GanttHeader({
  startDate,
  endDate,
  viewMode,
  dayWidth,
  sidebarWidth,
}: GanttHeaderProps) {
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

  const totalWidth = dates.length * dayWidth

  return (
    <div
      className="sticky top-0 z-20 flex"
      style={{ backgroundColor: GANTT_CONFIG.COLORS.HEADER_BG }}
    >
      {/* Sidebar spacer */}
      <div
        className="flex-shrink-0 border-r border-b"
        style={{
          width: sidebarWidth,
          height: GANTT_CONFIG.HEADER_HEIGHT,
          borderColor: GANTT_CONFIG.COLORS.GRID_LINE,
        }}
      />

      {/* Date header */}
      <div className="relative overflow-hidden">
        <svg
          width={totalWidth}
          height={GANTT_CONFIG.HEADER_HEIGHT}
          className="block"
        >
          {/* Month row */}
          <g>
            {months.map((monthGroup, i) => {
              const x = monthGroup.startIndex * dayWidth
              const width = monthGroup.count * dayWidth

              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={0}
                    width={width}
                    height={24}
                    fill={GANTT_CONFIG.COLORS.HEADER_BG}
                  />
                  <text
                    x={x + 8}
                    y={16}
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
                      y1={0}
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
                      y={24}
                      width={dayWidth}
                      height={24}
                      fill={GANTT_CONFIG.COLORS.WEEKEND}
                    />
                  )}

                  {/* Today highlight */}
                  {today && (
                    <rect
                      x={x}
                      y={24}
                      width={dayWidth}
                      height={24}
                      fill="#FEE2E2"
                    />
                  )}

                  {/* Day label */}
                  {(viewMode === 'day' || date.getDate() === 1 || date.getDay() === 1) && (
                    <text
                      x={x + dayWidth / 2}
                      y={40}
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
                    y1={24}
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
