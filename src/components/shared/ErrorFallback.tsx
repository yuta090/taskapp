'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { WarningCircle, ArrowCounterClockwise, House } from '@phosphor-icons/react'

interface ErrorFallbackProps {
  error: Error & { digest?: string }
  reset: () => void
  variant?: 'full' | 'inline'
}

export function ErrorFallback({ error, reset, variant = 'full' }: ErrorFallbackProps) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error)
  }, [error])

  const content = (
    <div role="alert" className="flex flex-col items-center gap-4 text-center">
      <WarningCircle size={48} weight="fill" className="text-red-500" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-gray-900">
          エラーが発生しました
        </h2>
        <p className="text-sm text-gray-500">
          予期しないエラーが発生しました。再試行するか、ホームに戻ってください。
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
          再試行
        </button>
        <Link
          href="/"
          className="text-sm text-indigo-600 hover:underline"
        >
          <span className="inline-flex items-center gap-1">
            <House size={14} aria-hidden="true" />
            ホームに戻る
          </span>
        </Link>
      </div>
      {process.env.NODE_ENV === 'development' && error.digest && (
        <p className="text-2xs text-gray-400">Digest: {error.digest}</p>
      )}
    </div>
  )

  if (variant === 'inline') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        {content}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-25 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-subtle">
        {content}
      </div>
    </div>
  )
}
