'use client'

import { CheckCircle, XCircle, Clock } from '@phosphor-icons/react'
import type { Review, ReviewApproval, Task } from '@/types/database'

interface ReviewWithTask extends Review {
  task?: Task
  approvals?: ReviewApproval[]
}

interface ReviewListProps {
  reviews: ReviewWithTask[]
  selectedId?: string
  onSelect?: (review: ReviewWithTask) => void
}

function StatusIcon({ status }: { status: Review['status'] }) {
  switch (status) {
    case 'approved':
      return <CheckCircle weight="fill" className="text-green-500" />
    case 'changes_requested':
      return <XCircle weight="fill" className="text-red-500" />
    default:
      return <Clock className="text-amber-500" />
  }
}

export function ReviewList({ reviews, selectedId, onSelect }: ReviewListProps) {
  if (reviews.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400">
        <Clock className="text-4xl mx-auto mb-2 opacity-50" />
        <p className="text-sm">承認待ちの項目はありません</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {reviews.map((review) => (
        <div
          key={review.id}
          className={`row-h flex items-center gap-3 px-4 cursor-pointer transition-colors ${
            selectedId === review.id
              ? 'bg-blue-50 border-l-2 border-l-blue-500'
              : 'hover:bg-gray-50'
          }`}
          onClick={() => onSelect?.(review)}
        >
          {/* Status */}
          <div className="flex-shrink-0 text-lg">
            <StatusIcon status={review.status} />
          </div>

          {/* Task title */}
          <div className="flex-1 min-w-0">
            <span className="truncate">
              {review.task?.title || 'タスク'}
            </span>
          </div>

          {/* Approval count */}
          {review.approvals && (
            <div className="flex-shrink-0 text-xs text-gray-400">
              {review.approvals.filter((a) => a.state === 'approved').length}/
              {review.approvals.length} 承認
            </div>
          )}

          {/* Status badge */}
          <div className="flex-shrink-0">
            <span
              className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                review.status === 'approved'
                  ? 'bg-green-100 text-green-700'
                  : review.status === 'changes_requested'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {review.status === 'approved'
                ? '承認済'
                : review.status === 'changes_requested'
                ? '差し戻し'
                : '承認待ち'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
