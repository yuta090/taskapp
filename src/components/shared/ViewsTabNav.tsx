'use client'

import Link from 'next/link'
import { SquaresFour, ChartLine } from '@phosphor-icons/react'

type ViewType = 'gantt' | 'burndown'

interface ViewsTabNavProps {
  orgId: string
  spaceId: string
  activeView: ViewType
}

const tabs: { key: ViewType; label: string; icon: typeof SquaresFour }[] = [
  { key: 'gantt', label: 'ガントチャート', icon: SquaresFour },
  { key: 'burndown', label: 'バーンダウン', icon: ChartLine },
]

export function ViewsTabNav({ orgId, spaceId, activeView }: ViewsTabNavProps) {
  const basePath = `/${orgId}/project/${spaceId}/views`

  return (
    <div className="flex items-center gap-1 px-4 pt-2 bg-white border-b border-slate-200">
      {tabs.map((tab) => {
        const isActive = tab.key === activeView
        const Icon = tab.icon
        return (
          <Link
            key={tab.key}
            href={`${basePath}/${tab.key}`}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t transition-colors ${
              isActive
                ? 'text-slate-900 bg-slate-50 border border-slate-200 border-b-transparent -mb-px'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
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
