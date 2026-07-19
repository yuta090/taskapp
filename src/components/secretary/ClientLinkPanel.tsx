'use client'

import { useMemo, useState } from 'react'
import { Check } from '@phosphor-icons/react'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { useChannelIdentities } from '@/lib/hooks/useChannelIdentities'
import { LineFriendQr } from '@/components/secretary/LineFriendQr'
import { LinkCodeIssueButton } from '@/components/secretary/LinkCodeIssueButton'
import { ConnectionFlowSection, type ConnectState } from '@/components/secretary/ConnectionFlowSection'

/**
 * 連携ハブの「相手先をつなぐ」カード。
 *
 * identity(本人特定)・突合コード発行APIは一切変えない — 既存の LineFriendQr /
 * LinkCodeIssueButton をそのまま呼ぶだけの提示レイヤー。相手先も同じBotを
 * 友だち追加するため purpose は既定(self)のまま使い、説明文だけ相手先向けに寄せる。
 *
 * 接続済み(channel_identities>0)の相手先では、追加接続が通常運用なので
 * コード発行ボタン(=追加でつなぐ)と手順リマインドは常時見せ、QRだけ畳む
 * （ConnectionFlowSection kind="counterparty"）。
 */
export function ClientLinkPanel({ orgId }: { orgId: string }) {
  const { spaces: allSpaces } = useUserSpaces()
  // LINEハブの接続判定なので channel='line' に限定する（非LINE identityだけの相手先を
  // 「LINE接続済み」と誤判定してQRを畳んでしまわないように）。
  // QR/合言葉を出して相手先の友だち追加を待つ「接続待ち」画面なので polling:true
  // (WAITINGティア・15秒間隔)を有効化する(freshness tiers)。
  const { counts, isLoading: identitiesLoading } = useChannelIdentities(orgId, 'line', {
    polling: true,
  })
  const orgSpaces = useMemo(
    () => allSpaces.filter((s) => s.orgId === orgId && s.archivedAt === null),
    [allSpaces, orgId],
  )
  const [selectedSpaceId, setSelectedSpaceId] = useState('')

  if (orgSpaces.length === 0) {
    return <p className="text-xs text-gray-500">プロジェクトがありません。</p>
  }

  const linkedCount = selectedSpaceId ? (counts[selectedSpaceId] ?? 0) : 0
  // 接続状態が未確定(ロード中)のうちはloading扱いにし、QRを一度展開してから畳む
  // ちらつき・レイアウトシフトを避ける。
  const state: ConnectState = identitiesLoading ? 'loading' : linkedCount > 0 ? 'connected' : 'ready'

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        つなぎたい相手先を選び、出てきた合言葉（コード）を相手に渡します（口頭・紙・メールでもOK）。相手が秘書を友だち追加して合言葉を送ると、1対1でつながります。
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
        <ConnectionFlowSection
          kind="counterparty"
          state={state}
          summary={
            linkedCount > 0 ? (
              <div className="flex items-start gap-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <Check weight="bold" className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-600" />
                <span>この相手先は接続済みです（{linkedCount}件）。担当者を追加でつなげます。</span>
              </div>
            ) : undefined
          }
          stepsHint={
            <p className="text-[11px] text-gray-500">
              友だち追加のあと、発行したコードをトークに送ると連携できます（追加だけでは連携されません）。
            </p>
          }
          action={<LinkCodeIssueButton orgId={orgId} spaceId={selectedSpaceId} />}
          qr={<LineFriendQr orgId={orgId} />}
        />
      )}
    </div>
  )
}
