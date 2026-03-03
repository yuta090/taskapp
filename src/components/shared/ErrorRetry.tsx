'use client'

import { ArrowCounterClockwise } from '@phosphor-icons/react'

interface ErrorRetryProps {
  message?: string
  onRetry: () => void
}

/** データ取得失敗時のインラインリトライUI */
export function ErrorRetry({
  message = '読み込みに失敗しました',
  onRetry,
}: ErrorRetryProps) {
  return (
    <div className="text-center py-16">
      <p className="text-sm text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <ArrowCounterClockwise className="text-sm" />
        再試行
      </button>
    </div>
  )
}
