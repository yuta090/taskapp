'use client'

import { useTaskEvents } from '@/lib/hooks/useTaskEvents'
import {
  eventActionLabel,
  eventDetailText,
  isClientDecision,
  isMeetingEvent,
} from './taskEventDisplay'

interface TaskEventTimelineProps {
  taskId: string
  /** Resolve an actor's user_id to a display name (from useSpaceMembers). */
  getMemberName: (userId: string) => string
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Read-only audit trail for a task (言った言わない防止).
 * Renders task_events newest-first, surfacing who acted, when, on what evidence.
 */
export function TaskEventTimeline({ taskId, getMemberName }: TaskEventTimelineProps) {
  const { events, loading, error } = useTaskEvents(taskId)

  if (loading) {
    return <p className="text-xs text-gray-400 px-1 py-2">履歴を読み込み中…</p>
  }
  if (error) {
    return <p className="text-xs text-red-500 px-1 py-2">履歴の取得に失敗しました</p>
  }
  if (events.length === 0) {
    return <p className="text-xs text-gray-400 px-1 py-2">まだ履歴はありません</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => {
        const detail = eventDetailText(event)
        return (
          <li key={event.id} className="flex gap-2 text-sm">
            <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="font-medium text-gray-900">{eventActionLabel(event.action)}</span>
                <span className="text-gray-500">{getMemberName(event.actor_id)}</span>
                {isMeetingEvent(event) && (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                    会議
                  </span>
                )}
                {isClientDecision(event) && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                    クライアント確定
                  </span>
                )}
                <span className="ml-auto flex-shrink-0 text-xs text-gray-400">
                  {formatTimestamp(event.created_at)}
                </span>
              </div>
              {detail && (
                <p className="mt-0.5 truncate text-xs text-gray-600" title={detail}>
                  {detail}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
