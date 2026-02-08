'use client'

import { Tag } from '@phosphor-icons/react'
import type { WikiPage } from '@/types/database'

interface WikiPageRowProps {
  page: WikiPage
  isSelected: boolean
  onClick: () => void
}

export function WikiPageRow({ page, isSelected, onClick }: WikiPageRowProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHour = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return 'たった今'
    if (diffMin < 60) return `${diffMin}分前`
    if (diffHour < 24) return `${diffHour}時間前`
    if (diffDay < 7) return `${diffDay}日前`
    return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  }

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all border-b border-gray-100 last:border-b-0 ${
        isSelected
          ? 'bg-indigo-50/60 border-l-2 border-l-indigo-500'
          : 'hover:bg-gray-50/80 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex-1 min-w-0">
        <h3 className={`text-sm font-medium truncate ${isSelected ? 'text-indigo-900' : 'text-gray-900'}`}>
          {page.title}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          {page.tags.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="text-gray-400 text-xs" />
              {page.tags.slice(0, 3).map(tag => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded"
                >
                  {tag}
                </span>
              ))}
              {page.tags.length > 3 && (
                <span className="text-[10px] text-gray-400">+{page.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="text-xs text-gray-400 flex-shrink-0">
        {formatDate(page.updated_at)}
      </div>
    </div>
  )
}
