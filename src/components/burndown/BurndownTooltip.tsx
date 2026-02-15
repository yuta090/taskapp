'use client'

import type { DailySnapshot } from '@/lib/burndown/computeBurndown'

interface BurndownTooltipProps {
  snapshot: DailySnapshot
  x: number
  y: number
  chartPadding: { top: number; left: number }
}

function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  const date = new Date(
    Number(dateStr.split('-')[0]),
    m - 1,
    d
  )
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()]
  return `${m}/${d} (${weekday})`
}

export function BurndownTooltip({
  snapshot,
  x,
  y,
  chartPadding,
}: BurndownTooltipProps) {
  const tooltipWidth = 140
  const tooltipHeight = 80
  const padding = 8

  // Prevent tooltip from going off-screen
  const tooltipX = x + tooltipWidth + padding > 600
    ? x - tooltipWidth - padding
    : x + padding

  const tooltipY = Math.max(
    chartPadding.top,
    Math.min(y - tooltipHeight / 2, 300)
  )

  return (
    <g>
      {/* Background */}
      <rect
        x={tooltipX}
        y={tooltipY}
        width={tooltipWidth}
        height={tooltipHeight}
        rx={6}
        fill="#1E293B"
        opacity={0.95}
      />

      {/* Date */}
      <text
        x={tooltipX + 10}
        y={tooltipY + 18}
        fontSize={12}
        fontWeight={600}
        fill="white"
      >
        {formatDateLabel(snapshot.date)}
      </text>

      {/* Remaining */}
      <text
        x={tooltipX + 10}
        y={tooltipY + 36}
        fontSize={11}
        fill="#94A3B8"
      >
        残: {snapshot.remaining}タスク
      </text>

      {/* Completed */}
      {snapshot.completed > 0 && (
        <text
          x={tooltipX + 10}
          y={tooltipY + 52}
          fontSize={11}
          fill="#94A3B8"
        >
          完了: +{snapshot.completed}
        </text>
      )}

      {/* Added */}
      {snapshot.added > 0 && (
        <text
          x={tooltipX + 10}
          y={tooltipY + 68}
          fontSize={11}
          fill="#FCD34D"
        >
          追加: +{snapshot.added}
        </text>
      )}

      {/* Reopened */}
      {snapshot.reopened > 0 && (
        <text
          x={tooltipX + 10}
          y={snapshot.added > 0 ? tooltipY + 84 : tooltipY + 68}
          fontSize={11}
          fill="#F87171"
        >
          再開: +{snapshot.reopened}
        </text>
      )}
    </g>
  )
}
