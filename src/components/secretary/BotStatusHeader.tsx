'use client'

import { useState } from 'react'
import { Robot, ToggleLeft, ToggleRight, PlugsConnected } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { ChannelAccountMeta, ViewerRole } from '@/lib/hooks/useChannelAccount'

interface BotStatusHeaderProps {
  account: ChannelAccountMeta | null
  viewerRole: ViewerRole | null
  onToggle: (accountId: string, status: 'active' | 'disabled') => Promise<void>
  isLoading: boolean
}

/**
 * 秘書コンソールのヘッダー: bot状態カード。
 * 有効/無効トグルはowner/adminのみ表示(docs/spec/AI_SECRETARY_STAGE2_DESIGN.md §5)。
 * disabled = 受信の記録は続けるが自動応答/digest/送信APIだけ止まる状態(§1)。
 */
export function BotStatusHeader({ account, viewerRole, onToggle, isLoading }: BotStatusHeaderProps) {
  const [toggling, setToggling] = useState(false)
  const canToggle = viewerRole === 'owner' || viewerRole === 'admin'

  if (isLoading) {
    return (
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-100 animate-pulse" />
        <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 text-gray-500">
        <PlugsConnected className="text-xl text-gray-400" />
        <div>
          <p className="text-sm font-medium text-gray-700">LINEアカウント未接続</p>
          <p className="text-xs text-gray-400">
            事務所のLINE公式アカウントの接続はサポート担当が代行します。お問い合わせください。
          </p>
        </div>
      </div>
    )
  }

  const handleToggle = async () => {
    const next = account.status === 'active' ? 'disabled' : 'active'
    setToggling(true)
    try {
      await onToggle(account.id, next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新に失敗しました')
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
        <Robot className="text-lg" weight="fill" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{account.displayName}</p>
        <p className="text-xs text-gray-400 truncate">{account.lineBotUserId ?? 'LINE'}</p>
      </div>
      <span
        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          account.status === 'active'
            ? 'bg-green-50 text-green-700'
            : 'bg-gray-100 text-gray-500'
        }`}
      >
        {account.status === 'active' ? '有効' : '無効'}
      </span>
      {canToggle && (
        <button
          type="button"
          onClick={handleToggle}
          disabled={toggling}
          data-testid="bot-status-toggle"
          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-50 transition-colors"
          title={account.status === 'active' ? '無効にする' : '有効にする'}
        >
          {account.status === 'active' ? (
            <ToggleRight className="text-3xl text-indigo-600" weight="fill" />
          ) : (
            <ToggleLeft className="text-3xl" weight="fill" />
          )}
        </button>
      )}
    </div>
  )
}
