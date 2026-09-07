'use client'

import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  className?: string
  /** 既定は上。ヘッダー内など上が見切れる場所では 'bottom' を使う */
  placement?: 'top' | 'bottom'
}

/**
 * 軽量なホバー/フォーカス限定のツールチップ。CSSのみで開閉するため状態を持たない。
 * 依存追加を避けるため、ネイティブ title 属性ではなく群 (group) ベースの
 * hover/focus-within クラスで表示を切り替える。
 */
export function Tooltip({ content, children, className = '', placement = 'top' }: TooltipProps) {
  const position = placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
  return (
    <span className={`relative inline-flex group/tooltip ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${position} left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[11px] text-gray-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100`}
      >
        {content}
      </span>
    </span>
  )
}
