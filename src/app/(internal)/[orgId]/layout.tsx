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
 * 誤ブロック回避（重要）: ネットワークで所属org一覧の確認が取れる(orgsStatus === 'verified')まで
 * children を出す（false negative 側に倒す）。IDB の永続キャッシュから復元しただけの一覧
 * （orgsStatus === 'cached'）は、再読み込み直後のまだ古いかもしれない一覧なのでブロック判定には
 * 使わない。同様に、verified のまま直近の裏取り直しだけが失敗している状態（orgsRefreshFailed）も
 * 使わない: 招待受諾などで所属が増えた直後に取り直しが失敗すると、新しい org を含まない
 * 古い一覧のまま verified を保つ（H1: activeOrgId を後退させない意図的な挙動）ため、
 * それだけで「本当に所属していない」と誤判定してしまう。
 * verified 済み・直近の取り直しも失敗していない、かつ URL の org に所属していないときだけ
 * 403 を表示する。active org Cookie はここでは一切書き換えない（誤URL踏みで active org を
 * 汚染しないため）。
 */
export default function OrgScopedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { orgs, orgsStatus, orgsRefreshFailed } = useContext(ActiveOrgContext)
  const params = useParams<{ orgId: string }>()
  const orgId = typeof params?.orgId === 'string' ? params.orgId : ''

  const isMember = orgs.some((o) => o.orgId === orgId)

  if (orgsStatus === 'verified' && !orgsRefreshFailed && orgs.length > 0 && !isMember) {
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
