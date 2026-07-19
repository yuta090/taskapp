'use client'

import { useState } from 'react'
import { Robot, ToggleLeft, ToggleRight, PlugsConnected } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { ChannelAccountMeta, ViewerRole } from '@/lib/hooks/useChannelAccount'

interface BotStatusHeaderProps {
  account: ChannelAccountMeta | null
  /** 自社LINEは無いが共通LINE（共有bot）を利用中か */
  sharedBotInUse?: boolean
  viewerRole: ViewerRole | null
  onToggle: (accountId: string, status: 'active' | 'disabled') => Promise<void>
  isLoading: boolean
}

/**
 * 秘書コンソールのヘッダー: LINEの状態カード。
 * つなぎ方を「共通LINE（共有）/ 自社LINE（自社の公式アカウント）」の言葉で示し、
 * 共通LINE利用中・未接続も出し分ける。有効/無効トグルはowner/adminのみ表示。
 * disabled = 受信の記録は続けるが自動応答/digest/送信APIだけ止まる状態。
 */
export function BotStatusHeader({
  account,
  sharedBotInUse = false,
  viewerRole,
  onToggle,
  isLoading,
}: BotStatusHeaderProps) {
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

  // 自社LINEは無いが共通LINE（共有bot）を利用中 → 「未接続」に見せない
  if (!account && sharedBotInUse) {
    return (
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center flex-shrink-0">
          <Robot className="text-lg" weight="fill" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
            共通LINEを利用中
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-teal-50 text-teal-700">
              共通LINE
            </span>
          </p>
          <p className="text-xs text-gray-400 truncate">
            TaskApp共通のLINEから届きます・相手先とはグループ単位でつながります
          </p>
        </div>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="px-4 py-3 border-b border-gray-200 flex items-start gap-3 text-gray-500">
        <PlugsConnected className="text-xl text-gray-400 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-gray-700">LINEはまだつながっていません</p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <b className="text-gray-600">共通LINE（すぐ使う）</b>：「相手先グループ」からコードを発行して相手のLINEグループに貼り付け。
            <br />
            <b className="text-gray-600">自社LINE（自社の名前で）</b>：公式アカウントの接続はサポートが代行します。
          </p>
        </div>
      </div>
    )
  }

  const isShared = account.ownerType === 'platform'

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
      <div
        className={`w-8 h-8 rounded-lg text-white flex items-center justify-center flex-shrink-0 ${
          isShared ? 'bg-teal-600' : 'bg-indigo-600'
        }`}
      >
        <Robot className="text-lg" weight="fill" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-2">
          <span className="truncate">{account.displayName}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
              isShared ? 'bg-teal-50 text-teal-700' : 'bg-indigo-50 text-indigo-700'
            }`}
          >
            {isShared ? '共通LINE' : '自社LINE'}
          </span>
        </p>
        <p className="text-xs text-gray-400 truncate">
          {isShared ? 'TaskApp共通のLINEから届きます' : '自社のLINE公式アカウントから届きます'}
        </p>
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
