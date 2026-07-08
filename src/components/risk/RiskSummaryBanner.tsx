import Link from 'next/link'
import { Warning, ArrowRight } from '@phosphor-icons/react'

interface RiskSummaryBannerProps {
  /** 期限超過タスク数（未完了かつ期限切れ） */
  overdueCount: number
  /** 高リスクのマイルストーン数 */
  highRiskCount: number
  /** クリック時の遷移先（ガント等） */
  href: string
}

/**
 * リスク/期限超過のサマリーバナー (#89)。
 * タスク一覧の先頭に置き、PM がガントを開かなくても遅延に気づけるようにする。
 * 期限超過・高リスクが 0 件のときは何も描画しない。
 */
export function RiskSummaryBanner({
  overdueCount,
  highRiskCount,
  href,
}: RiskSummaryBannerProps) {
  if (overdueCount <= 0 && highRiskCount <= 0) return null

  return (
    <Link
      href={href}
      data-testid="risk-summary-banner"
      className="flex items-center gap-2 px-4 md:px-5 py-1.5 bg-red-50 border-b border-red-100 text-xs text-red-700 hover:bg-red-100 transition-colors"
    >
      <Warning weight="fill" className="w-3.5 h-3.5 flex-shrink-0" />
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {overdueCount > 0 && (
          <span className="font-medium">
            期限超過 <span className="tabular-nums">{overdueCount}</span> 件
          </span>
        )}
        {highRiskCount > 0 && (
          <span className="font-medium">
            高リスク <span className="tabular-nums">{highRiskCount}</span> 件
          </span>
        )}
      </div>
      <span className="flex items-center gap-0.5 text-red-600 flex-shrink-0">
        ガントで確認
        <ArrowRight weight="bold" className="w-3 h-3" />
      </span>
    </Link>
  )
}
