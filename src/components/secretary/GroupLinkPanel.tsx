'use client'

import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react'
import { LineFriendQr } from '@/components/secretary/LineFriendQr'

/**
 * 連携ハブの「グループをつなぐ」カード。
 *
 * グループ紐付けは一括発行・承認待ちなど複雑なため、ハブ内では完全再現せず
 * 友だち追加QR＋手順の案内だけを出し、実際のコード発行/承認は既存の
 * group-links ページ（GroupLinksClient）へ誘導する（バックエンド・APIは一切変えない）。
 */
export function GroupLinkPanel({ orgId }: { orgId: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        顧問先グループの申し送りを秘書に受け取らせるための紐付けです。下の手順で友だち追加・招待し、
        コードを送信してください。
      </p>

      <LineFriendQr orgId={orgId} purpose="group" />

      <Link
        href={`/${orgId}/secretary/group-links`}
        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
      >
        グループ紐付けを管理する
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  )
}
