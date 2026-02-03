'use client'

import { Calendar, Play, CheckCircle, Clock } from '@phosphor-icons/react'
import type { Meeting, MeetingStatus } from '@/types/database'

interface MeetingRowProps {
  meeting: Meeting
  isSelected?: boolean
  onClick?: () => void
}

function StatusBadge({ status }: { status: MeetingStatus }) {
  switch (status) {
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-green-100 text-green-700">
          <Play weight="fill" className="text-xs" />
          進行中
        </span>
      )
    case 'ended':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600">
          <CheckCircle weight="fill" className="text-xs" />
          終了
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-blue-100 text-blue-600">
          <Clock className="text-xs" />
          予定
        </span>
      )
  }
}

export function MeetingRow({ meeting, isSelected, onClick }: MeetingRowProps) {
  return (
    <div
      className={`row-h flex items-center gap-3 px-4 border-b border-gray-100 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50 border-l-2 border-l-blue-500'
          : 'hover:bg-gray-50'
      }`}
      onClick={onClick}
    >
      {/* Date */}
      <div className="flex-shrink-0 text-gray-400">
        <Calendar className="text-lg" />
      </div>

      {/* Title + Date */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="truncate font-medium">{meeting.title}</span>
        {meeting.held_at && (
          <span className="text-xs text-gray-400">
            {new Date(meeting.held_at).toLocaleDateString('ja-JP', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
      </div>

      {/* Status */}
      <div className="flex-shrink-0">
        <StatusBadge status={meeting.status} />
      </div>
    </div>
  )
}
