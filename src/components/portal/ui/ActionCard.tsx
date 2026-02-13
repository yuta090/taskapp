'use client'

import { useState } from 'react'
import { CaretRight, PaperPlaneTilt } from '@phosphor-icons/react'

interface ActionCardProps {
  id: string
  title: string
  dueDate?: string | null
  isOverdue?: boolean
  waitingDays?: number
  type?: 'task' | 'spec'
  selected?: boolean
  processing?: boolean
  onApprove?: (id: string, comment: string) => Promise<void>
  onRequestChanges?: (id: string, comment: string) => Promise<void>
  onViewDetail?: (id: string) => void
}

export function ActionCard({
  id,
  title,
  dueDate,
  isOverdue = false,
  waitingDays,
  type = 'task',
  selected = false,
  processing = false,
  onApprove,
  onRequestChanges,
  onViewDetail,
}: ActionCardProps) {
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showInput, setShowInput] = useState(false)

  const disabled = isSubmitting || processing

  const handleApprove = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onApprove || disabled) return
    setIsSubmitting(true)
    onApprove(id, comment)
  }

  const handleRequestChanges = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onRequestChanges || !comment.trim() || disabled) return
    setIsSubmitting(true)
    onRequestChanges(id, comment)
  }

  // Parse date string safely to avoid timezone issues
  // YYYY-MM-DD strings are parsed as local time, not UTC
  const parseDate = (dateStr: string): Date => {
    // Check if it's a date-only string (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number)
      return new Date(year, month - 1, day)
    }
    // Otherwise, let Date parse it (handles ISO strings with timezone)
    return new Date(dateStr)
  }

  const formatDueDate = (date: string) => {
    const d = parseDate(date)
    const now = new Date()
    // Normalize to midnight for comparison
    const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diffDays = Math.round((dMidnight.getTime() - nowMidnight.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return '今日'
    if (diffDays === 1) return '明日'
    if (diffDays === -1) return '昨日'
    if (diffDays < 0) return `${Math.abs(diffDays)}日遅れ`

    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  }

  // Processing state: show spinner overlay with fade
  if (processing) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 animate-pulse">
        <div className="flex items-center gap-3">
          <span className="w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin flex-shrink-0" />
          <span className="text-sm text-gray-500 truncate">{title}</span>
          <span className="ml-auto text-xs text-gray-400">処理中...</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`group rounded-lg transition-all duration-200 ${selected
          ? 'bg-indigo-50/60 ring-1 ring-indigo-500/20'
          : showInput
            ? 'bg-gray-50 border border-gray-200'
            : 'hover:bg-gray-50/80 border border-transparent hover:border-gray-200/60'
        }`}
      onClick={() => !showInput && onViewDetail?.(id)}
    >
      {/* Main row: Title + Due date + Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3">
        {/* Left: Task Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
          <h3 className="text-lg font-semibold text-gray-900 truncate">
            {title}
          </h3>
          {type === 'spec' && (
            <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-purple-50 text-purple-600 rounded">
              SPEC
            </span>
          )}
        </div>

        {/* Right: Due date (always visible) + Actions (hover) */}
        <div className="mt-2 sm:mt-0 flex items-center gap-3 flex-shrink-0">
          {/* Due date - always visible */}
          {dueDate && (
            <span className={`inline-flex items-center gap-1.5 text-sm tabular-nums ${
              isOverdue ? 'text-rose-500 font-medium' : 'text-gray-400'
            }`}>
              {isOverdue && <span className="w-1.5 h-1.5 bg-rose-500 rounded-full flex-shrink-0 animate-pulse" />}
              <span>{formatDueDate(dueDate)}</span>
            </span>
          )}

          {/* Action buttons - visible on hover */}
          {!showInput && (
            <div className={`flex items-center gap-2 ${
              showInput ? '' : 'sm:opacity-0 sm:group-hover:opacity-100'
            } transition-opacity`}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowInput(true)
                }}
                className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 hover:bg-white rounded-md transition-all border border-transparent hover:border-gray-200 hover:shadow-sm"
              >
                修正依頼
              </button>
              <button
                onClick={handleApprove}
                disabled={disabled}
                className="px-3 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-700 rounded-md transition-all border border-indigo-100"
              >
                承認
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded input area - inline, not absolute */}
      {showInput && (
        <div className="px-3 pb-3" onClick={e => e.stopPropagation()}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="コメントを入力..."
            rows={2}
            className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowInput(false)
                setComment('')
              }}
              className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-md"
            >
              キャンセル
            </button>
            <button
              onClick={handleApprove}
              disabled={disabled}
              className="px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded-md"
            >
              承認
            </button>
            <button
              onClick={handleRequestChanges}
              disabled={disabled || !comment.trim()}
              className="px-3 py-1.5 text-xs font-bold text-white bg-gray-900 rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              送信
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
