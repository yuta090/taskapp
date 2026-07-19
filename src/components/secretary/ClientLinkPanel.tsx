'use client'

import { useMemo, useState } from 'react'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { LineFriendQr } from '@/components/secretary/LineFriendQr'
import { LinkCodeIssueButton } from '@/components/secretary/LinkCodeIssueButton'

/**
 * 連携ハブの「相手先をつなぐ」カード。
 *
 * identity(本人特定)・突合コード発行APIは一切変えない — 既存の LineFriendQr /
 * LinkCodeIssueButton をそのまま呼ぶだけの提示レイヤー。相手先も同じBotを
 * 友だち追加するため purpose は既定(self)のまま使い、説明文だけ相手先向けに寄せる。
 */
export function ClientLinkPanel({ orgId }: { orgId: string }) {
  const { spaces: allSpaces } = useUserSpaces()
  const orgSpaces = useMemo(
    () => allSpaces.filter((s) => s.orgId === orgId && s.archivedAt === null),
    [allSpaces, orgId],
  )
  const [selectedSpaceId, setSelectedSpaceId] = useState('')

  if (orgSpaces.length === 0) {
    return <p className="text-xs text-gray-500">プロジェクトがありません。</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        相手先を選んでコードを発行し、相手先に渡します（紙やメールでもOK）。相手先が友だち追加してコードを送ると連携できます。
      </p>

      <select
        value={selectedSpaceId}
        onChange={(e) => setSelectedSpaceId(e.target.value)}
        className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        <option value="">プロジェクトを選択</option>
        {orgSpaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {selectedSpaceId && (
        <div className="space-y-2">
          <LinkCodeIssueButton orgId={orgId} spaceId={selectedSpaceId} />
          <LineFriendQr orgId={orgId} />
        </div>
      )}
    </div>
  )
}
