'use client'

import { Clock, Warning } from '@phosphor-icons/react'
import { MetricCard } from './MetricCard'

interface NextDeliveryMetricProps {
  milestoneName?: string
  dueDate: string | null
  overdueDays: number
}

/**
 * "次回納品予定" metric card. Extracted so the date and the overdue-day-count
 * label can be laid out (and tested) independently of the date value —
 * H-5: at large day counts (e.g. 263日超過) an inline "date (Nヽ超過)" line
 * overflowed/wrapped mid-parenthesis inside the narrow bento card.
 */
export function NextDeliveryMetric({ milestoneName, dueDate, overdueDays }: NextDeliveryMetricProps) {
  const isOverdue = overdueDays > 0
  const dateStr = dueDate
    ? new Date(dueDate + 'T00:00:00').toLocaleDateString('ja-JP')
    : '未定'

  return (
    <MetricCard
      label="次回納品予定"
      status={isOverdue ? 'needs_attention' : 'default'}
      value={
        isOverdue ? (
          <span className="flex flex-col min-w-0">
            <span className="text-rose-600 truncate">{dateStr}</span>
            <span className="text-sm font-bold text-rose-500 whitespace-nowrap">{overdueDays}日超過</span>
          </span>
        ) : (
          <span className="truncate">{dateStr}</span>
        )
      }
      trend={{
        text: isOverdue
          ? `${milestoneName || 'マイルストーン'} — 未完了タスクの対応が必要です`
          : milestoneName || 'フェーズ未定',
      }}
      icon={
        isOverdue
          ? <Warning weight="duotone" className="text-rose-500" />
          : <Clock weight="duotone" />
      }
    />
  )
}
