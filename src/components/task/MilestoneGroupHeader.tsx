'use client'

import { CaretDown, CaretRight, Check } from '@phosphor-icons/react'
import type { Milestone } from '@/types/database'

interface MilestoneGroupHeaderProps {
  milestone: Milestone | null
  taskCount: number
  doneCount?: number
  isCollapsed?: boolean
  onToggle?: () => void
  label?: string
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
  doneCount = 0,
  isCollapsed = false,
  onToggle,
  label,
}: MilestoneGroupHeaderProps) {
  const progressPercent = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0
  const formattedDueDate = milestone?.due_date ? formatDate(milestone.due_date) : null

  return (
    <div
      className="sticky top-0 z-10 bg-white flex items-center gap-2 px-2 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors select-none border-b border-gray-100"
      onClick={onToggle}
    >
      {/* Collapse toggle */}
      <div className="text-gray-400 w-4 flex justify-center">
        {isCollapsed ? (
          <CaretRight weight="bold" className="text-[10px]" />
        ) : (
          <CaretDown weight="bold" className="text-[10px]" />
        )}
      </div>

      {/* Milestone name - bold */}
      <span className="text-[13px] font-semibold text-gray-800 tracking-tight">
        {label || milestone?.name || 'マイルストーン未設定'}
      </span>

      {/* Due date - right after title */}
      {formattedDueDate && (
        <span className="text-xs text-gray-400 tabular-nums">
          {formattedDueDate}
        </span>
      )}

      {/* Task count */}
      <span className="text-xs text-gray-400 tabular-nums">
        ({taskCount})
      </span>

      {/* Completion badge */}
      {milestone?.completed_at && (
        <span className="flex items-center gap-0.5 text-[11px] text-green-600 font-medium">
          <Check weight="bold" className="text-[10px]" />
          完了
        </span>
      )}

      {/* Progress bar */}
      {taskCount > 0 && (
        <div className="flex items-center gap-1.5 ml-1">
          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                progressPercent === 100 ? 'bg-green-500' : 'bg-blue-400'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400 tabular-nums w-7 text-right">
            {progressPercent}%
          </span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  )
}
