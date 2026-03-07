'use client'

import { VendorPortalShell } from '@/components/vendor-portal'
import { ListChecks, ArrowRight, CurrencyJpy } from '@phosphor-icons/react'
import Link from 'next/link'

interface VendorDashboardClientProps {
  spaceId: string
  spaceName: string
  orgId: string
  stats: {
    vendorBall: number
    agencyBall: number
    total: number
  }
}

export function VendorDashboardClient({
  spaceId,
  spaceName,
  orgId,
  stats,
}: VendorDashboardClientProps) {
  return (
    <VendorPortalShell
      currentProject={{ id: spaceId, name: spaceName, orgId }}
      actionCount={stats.vendorBall}
    >
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          {spaceName}
        </h1>

        {/* Stats cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-xs text-gray-500 mb-1">自社対応中</div>
            <div className="text-3xl font-bold text-indigo-600">{stats.vendorBall}</div>
            <div className="text-xs text-gray-400 mt-1">ボールが自社にあるタスク</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-xs text-gray-500 mb-1">代理店対応中</div>
            <div className="text-3xl font-bold text-amber-600">{stats.agencyBall}</div>
            <div className="text-xs text-gray-400 mt-1">代理店の確認待ち</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-xs text-gray-500 mb-1">全タスク</div>
            <div className="text-3xl font-bold text-gray-700">{stats.total}</div>
            <div className="text-xs text-gray-400 mt-1">進行中の全タスク</div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">クイックアクション</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/vendor-portal/tasks"
              className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all group"
            >
              <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
                <ListChecks className="text-indigo-600" size={20} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">タスク一覧</div>
                <div className="text-xs text-gray-500">進捗の確認・更新</div>
              </div>
              <ArrowRight className="text-gray-300 group-hover:text-indigo-400" size={16} />
            </Link>
            <Link
              href="/vendor-portal/estimates"
              className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all group"
            >
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <CurrencyJpy className="text-amber-600" size={20} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">見積もり</div>
                <div className="text-xs text-gray-500">工数・単価の入力</div>
              </div>
              <ArrowRight className="text-gray-300 group-hover:text-indigo-400" size={16} />
            </Link>
          </div>
        </div>
      </div>
    </VendorPortalShell>
  )
}
