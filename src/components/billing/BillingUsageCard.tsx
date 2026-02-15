'use client'

import { useBillingLimits } from '@/lib/hooks/useBillingLimits'
import { UsageBar } from './UsageBar'
import { LimitWarning } from './LimitWarning'
import { ArrowsClockwise } from '@phosphor-icons/react'

interface BillingUsageCardProps {
  orgId?: string
  showWarnings?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function BillingUsageCard({ orgId, showWarnings = true }: BillingUsageCardProps) {
  const {
    limits,
    loading,
    error,
    refresh,
    isAtLimit,
    getRemainingCount,
  } = useBillingLimits(orgId)

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="space-y-3">
            <div className="h-8 bg-gray-200 rounded" />
            <div className="h-8 bg-gray-200 rounded" />
            <div className="h-8 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-600">使用状況の読み込みに失敗しました</p>
          <button
            onClick={refresh}
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            <ArrowsClockwise className="w-4 h-4" />
            再読み込み
          </button>
        </div>
      </div>
    )
  }

  if (!limits) {
    return null
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">使用状況</h3>
          <p className="text-sm text-gray-500">
            現在のプラン: <span className="font-medium">{limits.plan_name}</span>
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          title="更新"
        >
          <ArrowsClockwise className="w-5 h-5" />
        </button>
      </div>

      {/* 警告表示 */}
      {showWarnings && (
        <div className="space-y-2">
          <LimitWarning
            type="projects"
            remaining={getRemainingCount('projects')}
            isAtLimit={isAtLimit('projects')}
          />
          <LimitWarning
            type="members"
            remaining={getRemainingCount('members')}
            isAtLimit={isAtLimit('members')}
          />
          <LimitWarning
            type="clients"
            remaining={getRemainingCount('clients')}
            isAtLimit={isAtLimit('clients')}
          />
        </div>
      )}

      {/* 使用状況バー */}
      <div className="space-y-4">
        <UsageBar
          label="プロジェクト"
          used={limits.projects_used}
          limit={limits.projects_limit}
        />
        <UsageBar
          label="メンバー"
          used={limits.members_used}
          limit={limits.members_limit}
        />
        <UsageBar
          label="外部"
          used={limits.clients_used}
          limit={limits.clients_limit}
        />
        <UsageBar
          label="ストレージ"
          used={limits.storage_used_bytes}
          limit={limits.storage_limit_bytes}
          unit=""
        />
        {limits.storage_limit_bytes !== null && (
          <p className="text-xs text-gray-500 text-right">
            {formatBytes(limits.storage_used_bytes)} / {formatBytes(limits.storage_limit_bytes)}
          </p>
        )}
      </div>
    </div>
  )
}
