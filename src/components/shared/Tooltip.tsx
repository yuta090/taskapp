'use client'

import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  className?: string
}

/**
 * 軽量なホバー/フォーカス限定のツールチップ。CSSのみで開閉するため状態を持たない。
 * 依存追加を避けるため、ネイティブ title 属性ではなく群 (group) ベースの
 * hover/focus-within クラスで表示を切り替える。
 */
export function Tooltip({ content, children, className = '' }: TooltipProps) {
  return (
    <span className={`relative inline-flex group/tooltip ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[11px] text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
      >
        {content}
      </span>
    </span>
  )
}
