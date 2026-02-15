'use client'

import { CaretDown } from '@phosphor-icons/react'
import type { Milestone } from '@/types/database'

interface BurndownControlsProps {
  milestones: Milestone[]
  selectedMilestoneId: string
  onSelectMilestone: (id: string) => void
  summary?: {
    remaining: number
    total: number
    startDate: string
    endDate: string
  }
}

export function BurndownControls({
  milestones,
  selectedMilestoneId,
  onSelectMilestone,
  summary,
}: BurndownControlsProps) {
  // Filter milestones with date range (start_date + due_date)
  const validMilestones = milestones.filter((ms) => ms.start_date || ms.due_date)

  const completionRate = summary && summary.total > 0
    ? Math.round(((summary.total - summary.remaining) / summary.total) * 100)
    : 0

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Milestone selector */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={selectedMilestoneId}
            onChange={(e) => onSelectMilestone(e.target.value)}
            className="appearance-none pl-3 pr-8 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">プロジェクト全体</option>
            {validMilestones.map((ms) => (
              <option key={ms.id} value={ms.id}>
                {ms.name}
              </option>
            ))}
          </select>
          <CaretDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {/* Period display */}
        {summary && (
          <span className="text-xs text-gray-500">
            {summary.startDate} ~ {summary.endDate}
          </span>
        )}
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="flex items-center gap-4 text-xs">
          <span className="text-gray-600">
            残: <span className="font-semibold text-gray-900">{summary.remaining}</span>
            <span className="text-gray-400"> / {summary.total}タスク</span>
          </span>
          <span className="text-gray-600">
            完了率: <span className="font-semibold text-gray-900">{completionRate}%</span>
          </span>
        </div>
      )}
    </div>
  )
}
