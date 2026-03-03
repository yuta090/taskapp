'use client'

import { SpinnerGap } from '@phosphor-icons/react'

interface LoadingStateProps {
  message?: string
}

/** データ読み込み中のインラインローディングUI */
export function LoadingState({ message = '読み込み中...' }: LoadingStateProps) {
  return (
    <div className="flex items-center justify-center gap-2 text-gray-400 py-16">
      <SpinnerGap className="text-lg animate-spin" />
      <span className="text-sm">{message}</span>
    </div>
  )
}
