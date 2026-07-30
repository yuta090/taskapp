'use client'

import Link from 'next/link'
import { SquaresFour, ChartLine, Receipt } from '@phosphor-icons/react'

type ViewType = 'gantt' | 'burndown' | 'billing'

interface ViewsTabNavProps {
  orgId: string
  spaceId: string
  activeView: ViewType
}

const tabs: { key: ViewType; label: string; icon: typeof SquaresFour }[] = [
  { key: 'gantt', label: 'ガントチャート', icon: SquaresFour },
  { key: 'burndown', label: 'バーンダウン', icon: ChartLine },
  // 「会計」ではなく「見積・請求」。会計データ全般が繋がると誤解させないための表記。
  { key: 'billing', label: '見積・請求', icon: Receipt },
]

export function ViewsTabNav({ orgId, spaceId, activeView }: ViewsTabNavProps) {
  const basePath = `/${orgId}/project/${spaceId}/views`

  return (
    <div className="flex items-center gap-1 px-4 pt-2 bg-surface border-b border-gray-200">
      {tabs.map((tab) => {
        const isActive = tab.key === activeView
        const Icon = tab.icon
        return (
          <Link
            key={tab.key}
            href={`${basePath}/${tab.key}`}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t transition-colors ${
              isActive
                ? 'text-gray-900 bg-gray-50 border border-gray-200 border-b-transparent -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
