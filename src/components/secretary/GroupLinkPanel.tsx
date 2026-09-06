'use client'

import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react'

/**
 * 連携ハブの「2. 相手先とのグループLINEをつなぐ」カードの中身。
 *
 * 手順（友だち追加→グループに招待→コード投稿）・QR・コード発行・確認待ちの承認は
 * すべて connect/line/groups ページ（GroupLinksClient）に集約してある。ハブで手順やQRを
 * 重ねて出すと、コードの発行場所が別画面なのに手順だけ先に読まされて迷うため、
 * ここは「次の画面で案内する」一言＋ボタンだけにする（バックエンド・APIは一切変えない）。
 */
export function GroupLinkPanel({ orgId }: { orgId: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">つなぎ方は次の画面で順番に案内します。</p>
      <Link
        href={`/${orgId}/secretary/connect/line/groups`}
        className="inline-flex items-center gap-1 rounded bg-gray-900 px-4 py-2 text-xs font-medium text-gray-100 hover:bg-gray-700"
      >
        グループをつなぐ
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  )
}
