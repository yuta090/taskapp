import { ReactNode } from 'react'

interface AmberBadgeProps {
  children?: ReactNode
  className?: string
}

/**
 * Amber Badge - Client-visible indicator
 *
 * UI Rule: クライアントに見えている要素は必ず Amber-500 のアイコン/バッジを付与
 */
export function AmberBadge({ children, className = '' }: AmberBadgeProps) {
  return (
    <span
      className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-600 ${className}`}
    >
      {children}
    </span>
  )
}

/**
 * Amber Dot - Simple indicator for client-visible items
 */
export function AmberDot({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full bg-amber-500 ${className}`}
      title="クライアント確認待ち"
    />
  )
}
