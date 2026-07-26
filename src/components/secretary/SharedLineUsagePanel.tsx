'use client'

import Link from 'next/link'
import { Sparkle } from '@phosphor-icons/react'
import { useSharedLineUsage } from '@/lib/hooks/useSharedLineUsage'

/**
 * 共通LINE(共有bot)の当月送信量パネル。接続済み(own/granted)のハブ画面に出す。
 *
 * 表示専用。実際の送信可否は送信境界（decideSharedSendBudget）が真実源で、これはその
 * 見える化。未接続(policy行なし)なら useSharedLineUsage が view=null を返すので何も出さない。
 * quota=null（Pro等の無制限）は「無制限」と出し、上限近く(soft)/到達(hard)で自社LINE(Pro)導線を添える。
 */
export function SharedLineUsagePanel({ orgId }: { orgId: string }) {
  const { view, loading } = useSharedLineUsage(orgId)

  if (loading || !view) return null

  if (view.unlimited) {
    return (
      <section className="rounded border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">今月の共通LINE送信</h2>
          <span className="text-sm font-medium text-gray-700">無制限</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          自社LINE（Pro）は送信量の上限がありません。
        </p>
      </section>
    )
  }

  const pct = Math.round((view.ratio ?? 0) * 100)
  // 進捗バーは semantic color（Info=blue / Warning=orange / Danger=red）。
  // amber は「クライアント可視要素」専用トークンのため警告状態には使わない。
  const barColor =
    view.level === 'hard' ? 'bg-red-600' : view.level === 'soft' ? 'bg-orange-600' : 'bg-blue-600'

  return (
    <section className="rounded border border-gray-200 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">今月の共通LINE送信</h2>
        <span className="text-sm tabular-nums text-gray-700">
          {view.used} / {view.quota} 通
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-valuenow={view.used}
        aria-valuemin={0}
        aria-valuemax={view.quota ?? undefined}
        aria-label="今月の共通LINE送信量"
      >
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      {view.level === 'ok' && (
        <p className="text-xs text-gray-500">今月あと {view.remaining} 通お送りできます。</p>
      )}
      {view.level === 'soft' && (
        <p className="text-xs text-orange-600">
          今月あと {view.remaining} 通です。上限が近づいています（翌月にリセットされます）。
        </p>
      )}
      {view.level === 'hard' && (
        <p className="text-xs text-red-600">
          今月の送信上限に達しました（翌月にリセットされます）。
        </p>
      )}

      {(view.level === 'soft' || view.level === 'hard') && (
        <Link
          href="/contact?plan=pro&topic=line-quota"
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900"
        >
          <Sparkle className="text-amber-500" />
          自社LINE（Pro）なら送信量を気にせず使えます
        </Link>
      )}
    </section>
  )
}
