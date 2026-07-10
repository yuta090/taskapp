'use client'

import { useState } from 'react'
import { Copy, Check } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { UserSpace } from '@/lib/hooks/useUserSpaces'

interface LinkCodeIssueButtonProps {
  orgId: string
  spaceId: string
}

/** 突合コード発行(1 space分)。発行後はコード＋期限をインライン表示しコピーできる */
function LinkCodeIssueButton({ orgId, spaceId }: LinkCodeIssueButtonProps) {
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const handleIssue = async () => {
    setIssuing(true)
    try {
      const response = await fetch('/api/channels/link-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, spaceId }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'コードの発行に失敗しました')
      setIssued({ code: json.code, expiresAt: json.expiresAt })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'コードの発行に失敗しました')
    } finally {
      setIssuing(false)
    }
  }

  const handleCopy = async () => {
    if (!issued) return
    await navigator.clipboard.writeText(issued.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (issued) {
    const expiresLabel = new Date(issued.expiresAt).toLocaleDateString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
    })
    return (
      <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 bg-gray-50 rounded text-xs">
        <span className="font-mono font-medium text-gray-900 tracking-wider">{issued.code}</span>
        <span className="text-gray-400 flex-shrink-0">{expiresLabel}まで</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void handleCopy()
          }}
          className="ml-auto p-1 text-gray-400 hover:text-gray-700 transition-colors"
          title="コピー"
        >
          {copied ? <Check className="text-xs text-green-600" /> : <Copy className="text-xs" />}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void handleIssue()
      }}
      disabled={issuing}
      className="mt-1.5 text-[11px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
    >
      {issuing ? '発行中...' : '確認コードを発行'}
    </button>
  )
}

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
