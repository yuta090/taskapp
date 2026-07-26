'use client'

import { useContext } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Prohibit } from '@phosphor-icons/react'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

/**
 * 所属外の組織URL（`/{orgId}/...`）に対する UX ガード（Fable裁定・論点2）。
 *
 * セキュリティ境界は引き続き DB 側の RLS。ここは「所属しない組織のURLを踏むと
 * RLSで中身が空になるだけで原因が分からない空画面」になるのを防ぐための表示ガード。
 *
 * 誤ブロック回避（重要）: 所属org一覧のロードが確定するまでは children を出す
 * （false negative 側に倒す）。orgs をロード済みで、かつ URL の org に所属して
 * いないときだけ 403 を表示する。active org Cookie はここでは一切書き換えない
 * （誤URL踏みで active org を汚染しないため）。
 */
export default function OrgScopedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { orgs, loading } = useContext(ActiveOrgContext)
  const params = useParams<{ orgId: string }>()
  const orgId = typeof params?.orgId === 'string' ? params.orgId : ''

  const isMember = orgs.some((o) => o.orgId === orgId)

  if (!loading && orgs.length > 0 && !isMember) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <Prohibit className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-base font-semibold text-gray-900">
            この組織へのアクセス権がありません
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            リンクが古いか、別のアカウントで開いている可能性があります。
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Link
              href="/my"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors"
            >
              自分のタスクへ移動
            </Link>
            <Link
              href="/inbox"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              受信箱を開く
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
