'use client'

import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  message: string
  action?: ReactNode
}

/** コンテンツが空の場合のインライン表示UI */
export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <div className="text-center text-gray-400 py-20">
      <div className="text-4xl mx-auto mb-3 opacity-50 flex justify-center">{icon}</div>
      <p className="text-sm">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
