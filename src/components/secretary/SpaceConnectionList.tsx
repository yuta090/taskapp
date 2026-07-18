'use client'

import type { UserSpace } from '@/lib/hooks/useUserSpaces'
import { LinkCodeIssueButton } from '@/components/secretary/LinkCodeIssueButton'

interface SpaceConnectionListProps {
  orgId: string
  spaces: UserSpace[]
  /** space_id -> active な channel_identities 件数 */
  identityCounts: Record<string, number>
  selectedSpaceId: string | null
  onSelect: (spaceId: string) => void
}

/** 左カラム: spaceごとのLINE連携状態＋突合コード発行 */
export function SpaceConnectionList({
  orgId,
  spaces,
  identityCounts,
  selectedSpaceId,
  onSelect,
}: SpaceConnectionListProps) {
  return (
    <div className="overflow-y-auto flex-1 py-2">
      {spaces.map((space) => {
        const count = identityCounts[space.id] ?? 0
        const isSelected = space.id === selectedSpaceId
        return (
          <div
            key={space.id}
            role="button"
            tabIndex={0}
            data-testid={`space-connection-${space.id}`}
            onClick={() => onSelect(space.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(space.id)
            }}
            className={`mx-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
              isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 truncate flex-1">{space.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                  count > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'
                }`}
              >
                {count > 0 ? `連携済み(${count})` : '未連携'}
              </span>
            </div>
            <LinkCodeIssueButton orgId={orgId} spaceId={space.id} />
          </div>
        )
      })}
    </div>
  )
}
