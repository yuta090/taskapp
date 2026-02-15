'use client'

import { Warning, ArrowRight } from '@phosphor-icons/react'
import Link from 'next/link'

interface LimitWarningProps {
  type: 'projects' | 'members' | 'clients' | 'storage'
  remaining: number | null
  isAtLimit: boolean
  upgradeUrl?: string
}

const typeLabels: Record<string, string> = {
  projects: 'プロジェクト',
  members: 'メンバー',
  clients: '外部',
  storage: 'ストレージ',
}

export function LimitWarning({
  type,
  remaining,
  isAtLimit,
  upgradeUrl = '/settings/billing',
}: LimitWarningProps) {
  const label = typeLabels[type] || type

  if (remaining === null) {
    return null
  }

  if (isAtLimit) {
    return (
      <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
        <Warning className="w-5 h-5 text-red-500 flex-shrink-0" weight="fill" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800">
            {label}の上限に達しました
          </p>
          <p className="text-xs text-red-600 mt-0.5">
            これ以上追加するにはプランのアップグレードが必要です
          </p>
        </div>
        <Link
          href={upgradeUrl}
          className="flex items-center gap-1 text-sm font-medium text-red-700 hover:text-red-800 flex-shrink-0"
        >
          アップグレード
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    )
  }

  if (remaining <= 2) {
    return (
      <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <Warning className="w-5 h-5 text-amber-500 flex-shrink-0" weight="fill" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800">
            {label}の残り枠: あと{remaining}
          </p>
          <p className="text-xs text-amber-600 mt-0.5">
            上限に近づいています
          </p>
        </div>
        <Link
          href={upgradeUrl}
          className="flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-800 flex-shrink-0"
        >
          プラン確認
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    )
  }

  return null
}
