'use client'

import { useEffect, useState } from 'react'
import { X, ArrowCounterClockwise } from '@phosphor-icons/react'

interface UndoToastProps {
  message: string
  duration?: number // milliseconds
  onUndo: () => void
  onDismiss: () => void
}

export function UndoToast({
  message,
  duration = 5000,
  onUndo,
  onDismiss
}: UndoToastProps) {
  const [progress, setProgress] = useState(100)
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    if (isPaused) return

    const interval = 50 // update every 50ms
    const decrement = (interval / duration) * 100

    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev - decrement
        if (next <= 0) {
          clearInterval(timer)
          onDismiss()
          return 0
        }
        return next
      })
    }, interval)

    return () => clearInterval(timer)
  }, [duration, onDismiss, isPaused])

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="bg-gray-900 text-white rounded-xl shadow-2xl overflow-hidden min-w-[300px]">
        <div className="px-4 py-3 flex items-center gap-3">
          <span className="text-sm flex-1">{message}</span>
          <button
            onClick={onUndo}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
          >
            <ArrowCounterClockwise className="w-4 h-4" />
            取り消し
          </button>
          <button
            onClick={onDismiss}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-amber-500 transition-all duration-50"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
