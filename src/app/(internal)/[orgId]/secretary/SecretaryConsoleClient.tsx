'use client'

import { useMemo, useState } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react'
import { EmptyState } from '@/components/shared'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { useChannelAccount } from '@/lib/hooks/useChannelAccount'
import { useChannelIdentities } from '@/lib/hooks/useChannelIdentities'
import { useChannelGroupCounts } from '@/lib/hooks/useChannelGroupCounts'
import { BotStatusHeader } from '@/components/secretary/BotStatusHeader'
import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'
import { SpaceConnectionList } from '@/components/secretary/SpaceConnectionList'
import { MessageTimeline } from '@/components/secretary/MessageTimeline'

interface SecretaryConsoleClientProps {
  orgId: string
}

/**
 * 秘書コンソール — /{orgId}/secretary
 * Main ペイン内2カラム(左: 接続リスト / 右: タイムライン＋送信)。Inspectorは使わない。
 * docs/spec/AI_SECRETARY_STAGE2_DESIGN.md §5
 */
export function SecretaryConsoleClient({ orgId }: SecretaryConsoleClientProps) {
  const { account, sharedBotInUse, viewerRole, isLoading: accountLoading, setStatus } = useChannelAccount(orgId)
  const { spaces: allSpaces } = useUserSpaces()
  const { counts: identityCounts } = useChannelIdentities(orgId)
  const { counts: groupCounts } = useChannelGroupCounts(orgId)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null)

  const spaces = useMemo(
    () => allSpaces.filter((s) => s.orgId === orgId && s.archivedAt === null),
    [allSpaces, orgId],
  )

  // 「連携済み」= 1:1DM(identity) だけでなくグループ接続でも成立させる。
  // Freeは相手先をグループ単位で繋ぐため、identityが無くてもグループがあれば送信できる。
  const connectionCounts = useMemo(() => {
    const merged: Record<string, number> = { ...identityCounts }
    for (const [spaceId, n] of Object.entries(groupCounts)) {
      merged[spaceId] = (merged[spaceId] ?? 0) + n
    }
    return merged
  }, [identityCounts, groupCounts])

  // 未選択時は先頭のspaceを既定にする(LeftNavのeffectiveSpaceIdと同じ考え方)
  const effectiveSpaceId = selectedSpaceId ?? spaces[0]?.id ?? null
  const selectedSpace = spaces.find((s) => s.id === effectiveSpaceId) ?? null
  const isLinked = (connectionCounts[selectedSpace?.id ?? ''] ?? 0) > 0

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SecretaryTabNav orgId={orgId} activeTab="messages" />
      <BotStatusHeader
        account={account}
        sharedBotInUse={sharedBotInUse}
        viewerRole={viewerRole}
        onToggle={setStatus}
        isLoading={accountLoading}
      />

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className="w-full md:w-[280px] flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-200 flex flex-col max-h-48 md:max-h-none overflow-hidden">
          <div className="px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide flex-shrink-0">
            相手先
          </div>
          {spaces.length === 0 ? (
            <EmptyState icon={<ChatCircleDots />} message="プロジェクトがありません" />
          ) : (
            <SpaceConnectionList
              orgId={orgId}
              spaces={spaces}
              connectionCounts={connectionCounts}
              selectedSpaceId={effectiveSpaceId}
              onSelect={setSelectedSpaceId}
            />
          )}
        </aside>

        <MessageTimeline orgId={orgId} space={selectedSpace} isLinked={isLinked} />
      </div>
    </div>
  )
}
