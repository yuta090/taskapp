'use client'

import { CaretDown, CaretRight } from '@phosphor-icons/react'
import type { Milestone } from '@/types/database'

interface MilestoneGroupHeaderProps {
  milestone: Milestone | null
  taskCount: number
  isCollapsed?: boolean
  onToggle?: () => void
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}/${day}`
}

export function MilestoneGroupHeader({
  milestone,
  taskCount,
  isCollapsed = false,
  onToggle,
}: MilestoneGroupHeaderProps) {
  const formattedDueDate = milestone?.due_date ? formatDate(milestone.due_date) : null

  return (
    <div
      className="flex items-center gap-2 px-2 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors select-none border-b border-slate-100"
      onClick={onToggle}
    >
      {/* Collapse toggle */}
      <div className="text-slate-400 w-4 flex justify-center">
        {isCollapsed ? (
          <CaretRight weight="bold" className="text-[10px]" />
        ) : (
          <CaretDown weight="bold" className="text-[10px]" />
        )}
      </div>

      {/* Milestone name - bold */}
      <span className="text-[13px] font-semibold text-slate-800 tracking-tight">
        {milestone?.name || 'マイルストーン未設定'}
      </span>

      {/* Due date - right after title */}
      {formattedDueDate && (
        <span className="text-xs text-slate-400 tabular-nums">
          {formattedDueDate}
        </span>
      )}

      {/* Task count */}
      <span className="text-xs text-slate-400 tabular-nums">
        ({taskCount})
      </span>

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  )
}
