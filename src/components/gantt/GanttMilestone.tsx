'use client'

import { useState, useMemo } from 'react'
import { GANTT_CONFIG } from '@/lib/gantt/constants'
import { dateToX, getDaysDiff } from '@/lib/gantt/dateUtils'
import type { Milestone } from '@/types/database'

interface GanttMilestoneProps {
  milestone: Milestone
  startDate: Date
  dayWidth: number
  chartHeight: number
}

type UrgencyLevel = 'normal' | 'warning' | 'urgent' | 'past'

function getUrgencyLevel(daysUntil: number): UrgencyLevel {
  if (daysUntil < 0) return 'past'
  if (daysUntil <= 3) return 'urgent'
  if (daysUntil <= 7) return 'warning'
  return 'normal'
}

function getUrgencyColors(level: UrgencyLevel): { line: string; bg: string; text: string } {
  switch (level) {
    case 'past':
      return {
        line: GANTT_CONFIG.COLORS.MILESTONE_PAST,
        bg: GANTT_CONFIG.COLORS.MILESTONE_PAST_BG,
        text: GANTT_CONFIG.COLORS.MILESTONE_PAST,
      }
    case 'urgent':
      return {
        line: GANTT_CONFIG.COLORS.MILESTONE_URGENT,
        bg: GANTT_CONFIG.COLORS.MILESTONE_URGENT_BG,
        text: GANTT_CONFIG.COLORS.MILESTONE_URGENT,
      }
    case 'warning':
      return {
        line: GANTT_CONFIG.COLORS.MILESTONE_WARN,
        bg: GANTT_CONFIG.COLORS.MILESTONE_WARN_BG,
        text: GANTT_CONFIG.COLORS.MILESTONE_WARN,
      }
    default:
      return {
        line: GANTT_CONFIG.COLORS.MILESTONE,
        bg: GANTT_CONFIG.COLORS.MILESTONE_BG,
        text: GANTT_CONFIG.COLORS.MILESTONE,
      }
  }
}

export function GanttMilestone({
  milestone,
  startDate,
  dayWidth,
  chartHeight,
}: GanttMilestoneProps) {
  const [isHovering, setIsHovering] = useState(false)

  const { dueDate, x, daysUntil, urgency, colors, dateLabel, daysLabel } = useMemo(() => {
    if (!milestone.due_date) return { dueDate: null, x: 0, daysUntil: 0, urgency: 'normal' as UrgencyLevel, colors: getUrgencyColors('normal'), dateLabel: '', daysLabel: '' }

    const due = new Date(milestone.due_date)
    const xPos = dateToX(due, startDate, dayWidth) + dayWidth / 2
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = getDaysDiff(today, due)
    const level = getUrgencyLevel(days)

    // Format labels
    const dateLbl = `${due.getMonth() + 1}/${due.getDate()}`
    let daysLbl = ''
    if (days < 0) {
      daysLbl = `${Math.abs(days)}日超過`
    } else if (days === 0) {
      daysLbl = '今日'
    } else {
      daysLbl = `残${days}日`
    }

    return {
      dueDate: due,
      x: xPos,
      daysUntil: days,
      urgency: level,
      colors: getUrgencyColors(level),
      dateLabel: dateLbl,
      daysLabel: daysLbl,
    }
  }, [milestone.due_date, startDate, dayWidth])

  if (!dueDate) return null

  const diamondSize = 12
  const labelHeight = 22

  // Estimate label width based on text length
  const labelText = milestone.name.length > 10
    ? milestone.name.slice(0, 10) + '…'
    : milestone.name
  const labelWidth = Math.max(labelText.length * 8 + 60, 100)

  return (
    <g
      className="gantt-milestone"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{ cursor: 'pointer' }}
    >
      {/* Column highlight - full height background */}
      <rect
        x={x - dayWidth / 2}
        y={0}
        width={dayWidth}
        height={chartHeight}
        fill={colors.bg}
        opacity={isHovering ? 0.6 : 0.3}
      />

      {/* Vertical line - solid and prominent */}
      <line
        x1={x}
        y1={labelHeight + diamondSize + 4}
        x2={x}
        y2={chartHeight}
        stroke={colors.line}
        strokeWidth={2}
        opacity={isHovering ? 1 : 0.7}
      />

      {/* Top label background */}
      <rect
        x={x - labelWidth / 2}
        y={0}
        width={labelWidth}
        height={labelHeight}
        rx={4}
        fill={isHovering ? colors.line : colors.bg}
        stroke={colors.line}
        strokeWidth={1.5}
      />

      {/* Label text - milestone name + days remaining */}
      <text
        x={x}
        y={labelHeight / 2 + 4}
        fontSize={11}
        fontWeight={600}
        fill={isHovering ? 'white' : colors.text}
        textAnchor="middle"
        style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
      >
        {labelText} ({daysLabel})
      </text>

      {/* Diamond marker below label */}
      <g transform={`translate(${x}, ${labelHeight + diamondSize / 2 + 2})`}>
        {/* Diamond shadow */}
        <path
          d={`M 0 ${-diamondSize / 2} L ${diamondSize / 2} 0 L 0 ${diamondSize / 2} L ${-diamondSize / 2} 0 Z`}
          fill="black"
          opacity={0.1}
          transform="translate(1, 1)"
        />
        {/* Diamond */}
        <path
          d={`M 0 ${-diamondSize / 2} L ${diamondSize / 2} 0 L 0 ${diamondSize / 2} L ${-diamondSize / 2} 0 Z`}
          fill={colors.line}
          stroke="white"
          strokeWidth={2}
        />
      </g>

      {/* Hover tooltip with full details */}
      {isHovering && (
        <g>
          <rect
            x={x - 90}
            y={labelHeight + diamondSize + 10}
            width={180}
            height={44}
            rx={6}
            fill="#1E293B"
            opacity={0.95}
          />
          <text
            x={x}
            y={labelHeight + diamondSize + 28}
            fontSize={12}
            fontWeight={600}
            fill="white"
            textAnchor="middle"
            style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
          >
            {milestone.name}
          </text>
          <text
            x={x}
            y={labelHeight + diamondSize + 44}
            fontSize={11}
            fill="#94A3B8"
            textAnchor="middle"
            style={{ fontFamily: GANTT_CONFIG.FONT.FAMILY }}
          >
            {dateLabel} • {daysLabel}
          </text>
        </g>
      )}
    </g>
  )
}
