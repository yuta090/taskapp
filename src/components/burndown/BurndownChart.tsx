'use client'

import { useState, useMemo } from 'react'
import { BURNDOWN_CONFIG } from '@/lib/burndown/constants'
import { BurndownTooltip } from './BurndownTooltip'
import type { BurndownData } from '@/lib/burndown/computeBurndown'

interface BurndownChartProps {
  data: BurndownData
}

export function BurndownChart({ data }: BurndownChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const { padding, chartWidth, chartHeight, innerWidth, innerHeight } = useMemo(() => {
    const p = BURNDOWN_CONFIG.CHART_PADDING
    const w = 800 // base width, will be responsive via viewBox
    const h = BURNDOWN_CONFIG.CHART_HEIGHT
    return {
      padding: p,
      chartWidth: w,
      chartHeight: h,
      innerWidth: w - p.left - p.right,
      innerHeight: h - p.top - p.bottom,
    }
  }, [])

  const { snapshots, maxY, xScale, yScale, idealLine, actualPoints, todayX } = useMemo(() => {
    const snaps = data.dailySnapshots
    if (snaps.length === 0) {
      return {
        snapshots: [],
        maxY: 0,
        xScale: () => 0,
        yScale: () => 0,
        idealLine: { x1: 0, y1: 0, x2: 0, y2: 0 },
        actualPoints: [],
        todayX: null as number | null,
      }
    }

    // Calculate total days in the full milestone period
    const startDate = new Date(data.startDate)
    const endDate = new Date(data.endDate)
    const totalDaysInPeriod = Math.max(
      1,
      Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    )

    // Max Y = max of totalTasks or max remaining
    const maxRemaining = Math.max(...snaps.map((s) => s.remaining), data.totalTasks)
    const my = Math.max(maxRemaining, 1)

    // X scale: map day index (0-based) to pixel position
    const xs = (dayIndex: number) =>
      padding.left + (dayIndex / totalDaysInPeriod) * innerWidth

    // Y scale: map value to pixel position
    const ys = (value: number) =>
      padding.top + innerHeight - (value / my) * innerHeight

    // Ideal line: straight from totalTasks to 0
    const ideal = {
      x1: xs(0),
      y1: ys(data.totalTasks),
      x2: xs(totalDaysInPeriod),
      y2: ys(0),
    }

    // Actual data points
    const points = snaps.map((s, i) => ({
      x: xs(i),
      y: ys(s.remaining),
      snapshot: s,
    }))

    // Today line
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayDayIndex = Math.round(
      (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    const tX = todayDayIndex >= 0 && todayDayIndex <= totalDaysInPeriod
      ? xs(todayDayIndex)
      : null

    return {
      snapshots: snaps,
      maxY: my,
      xScale: xs,
      yScale: ys,
      idealLine: ideal,
      actualPoints: points,
      todayX: tX,
    }
  }, [data, padding, innerWidth, innerHeight])

  if (snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-500">
        タスクがありません
      </div>
    )
  }

  // Grid lines
  const yGridLines = Array.from({ length: BURNDOWN_CONFIG.GRID_LINES_Y + 1 }, (_, i) => {
    const value = Math.round((maxY / BURNDOWN_CONFIG.GRID_LINES_Y) * i)
    return { value, y: yScale(value) }
  })

  // Actual line path
  const actualPath = actualPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ')

  // Area fill path
  const areaPath = actualPoints.length > 0
    ? `${actualPath} L ${actualPoints[actualPoints.length - 1].x} ${yScale(0)} L ${actualPoints[0].x} ${yScale(0)} Z`
    : ''

  // Date labels
  const dateLabels = snapshots.filter((_, i) => i % BURNDOWN_CONFIG.DATE_LABEL_SKIP === 0 || i === snapshots.length - 1)

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      className="w-full h-auto"
      style={{ maxHeight: `${BURNDOWN_CONFIG.CHART_HEIGHT}px` }}
    >
      {/* Y-axis grid lines */}
      {yGridLines.map(({ value, y }) => (
        <g key={`grid-${value}`}>
          <line
            x1={padding.left}
            y1={y}
            x2={chartWidth - padding.right}
            y2={y}
            stroke={BURNDOWN_CONFIG.COLORS.GRID}
            strokeWidth={1}
          />
          <text
            x={padding.left - 8}
            y={y + 4}
            fontSize={BURNDOWN_CONFIG.FONT.SIZE_XS}
            fill={BURNDOWN_CONFIG.COLORS.AXIS_TEXT}
            textAnchor="end"
          >
            {value}
          </text>
        </g>
      ))}

      {/* X-axis baseline */}
      <line
        x1={padding.left}
        y1={yScale(0)}
        x2={chartWidth - padding.right}
        y2={yScale(0)}
        stroke={BURNDOWN_CONFIG.COLORS.GRID}
        strokeWidth={1}
      />

      {/* Date labels */}
      {dateLabels.map((s) => {
        const idx = snapshots.indexOf(s)
        const [, m, d] = s.date.split('-').map(Number)
        return (
          <text
            key={s.date}
            x={xScale(idx)}
            y={chartHeight - padding.bottom + 20}
            fontSize={BURNDOWN_CONFIG.FONT.SIZE_XS}
            fill={BURNDOWN_CONFIG.COLORS.AXIS_TEXT}
            textAnchor="middle"
          >
            {m}/{d}
          </text>
        )
      })}

      {/* Ideal line */}
      <line
        x1={idealLine.x1}
        y1={idealLine.y1}
        x2={idealLine.x2}
        y2={idealLine.y2}
        stroke={BURNDOWN_CONFIG.COLORS.IDEAL_LINE}
        strokeWidth={2}
        strokeDasharray="6 4"
        opacity={0.7}
      />

      {/* Area fill under actual line */}
      {areaPath && (
        <path
          d={areaPath}
          fill={BURNDOWN_CONFIG.COLORS.ACTUAL_FILL}
          opacity={0.3}
        />
      )}

      {/* Actual line */}
      <path
        d={actualPath}
        fill="none"
        stroke={BURNDOWN_CONFIG.COLORS.ACTUAL_LINE}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points */}
      {actualPoints.map((p, i) => (
        <circle
          key={p.snapshot.date}
          cx={p.x}
          cy={p.y}
          r={hoveredIndex === i
            ? BURNDOWN_CONFIG.POINT_RADIUS_HOVER
            : BURNDOWN_CONFIG.POINT_RADIUS}
          fill={hoveredIndex === i
            ? BURNDOWN_CONFIG.COLORS.POINT_HOVER
            : BURNDOWN_CONFIG.COLORS.POINT}
          stroke="white"
          strokeWidth={2}
          onMouseEnter={() => setHoveredIndex(i)}
          onMouseLeave={() => setHoveredIndex(null)}
          style={{ cursor: 'pointer' }}
        />
      ))}

      {/* Today line */}
      {todayX !== null && (
        <g>
          <line
            x1={todayX}
            y1={padding.top}
            x2={todayX}
            y2={yScale(0)}
            stroke={BURNDOWN_CONFIG.COLORS.TODAY}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.6}
          />
          <text
            x={todayX}
            y={padding.top - 4}
            fontSize={BURNDOWN_CONFIG.FONT.SIZE_XS}
            fill={BURNDOWN_CONFIG.COLORS.TODAY}
            textAnchor="middle"
            fontWeight={600}
          >
            Today
          </text>
        </g>
      )}

      {/* Data available from indicator */}
      {data.dataAvailableFrom && data.dataAvailableFrom > data.startDate && (
        <g>
          {/* Shade the unreliable zone */}
          <rect
            x={padding.left}
            y={padding.top}
            width={Math.max(
              0,
              xScale(
                Math.round(
                  (new Date(data.dataAvailableFrom).getTime() -
                    new Date(data.startDate).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              ) - padding.left
            )}
            height={innerHeight}
            fill="#F1F5F9"
            opacity={0.5}
          />
          <text
            x={padding.left + 4}
            y={padding.top + 14}
            fontSize={9}
            fill="#94A3B8"
          >
            推定値
          </text>
        </g>
      )}

      {/* Hover hit areas (larger invisible targets) */}
      {actualPoints.map((p, i) => (
        <circle
          key={`hit-${p.snapshot.date}`}
          cx={p.x}
          cy={p.y}
          r={16}
          fill="transparent"
          onMouseEnter={() => setHoveredIndex(i)}
          onMouseLeave={() => setHoveredIndex(null)}
          style={{ cursor: 'pointer' }}
        />
      ))}

      {/* Tooltip */}
      {hoveredIndex !== null && actualPoints[hoveredIndex] && (
        <BurndownTooltip
          snapshot={actualPoints[hoveredIndex].snapshot}
          x={actualPoints[hoveredIndex].x}
          y={actualPoints[hoveredIndex].y}
          chartPadding={padding}
        />
      )}
    </svg>
  )
}
