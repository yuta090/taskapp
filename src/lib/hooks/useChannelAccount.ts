'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * チャネル配管APIのレスポンス型。channel_* テーブルは types/database.ts に無いため
 * このフック内でローカル定義する(docs/spec/AI_SECRETARY_STAGE2_DESIGN.md §5)。
 */
export interface ChannelAccountMeta {
  id: string
  channel: string
  displayName: string
  lineBotUserId: string | null
  status: 'active' | 'disabled'
  createdAt: string
  /** 'org'=自社LINE / 'platform'=共通LINE */
  ownerType: 'org' | 'platform'
}

export type ViewerRole = 'owner' | 'admin' | 'member'

interface AccountResponse {
  account: ChannelAccountMeta | null
  /** 自社LINEは無いが共通LINE（共有bot）のグループを持つ＝共通LINE利用中 */
  sharedBotInUse: boolean
  viewerRole: ViewerRole
}

/**
 * 秘書コンソールのbot状態カード用。GET/PATCH /api/channels/accounts のラッパー。
 * PATCH(有効/無効切替)はoptimistic updateで即時反映し、失敗時はロールバックする。
 */
export function useChannelAccount(orgId: string) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['channelAccount', orgId] as const, [orgId])

  const { data, isLoading, error } = useQuery<AccountResponse>({
    queryKey,
    queryFn: async (): Promise<AccountResponse> => {
      const response = await fetch(`/api/channels/accounts?orgId=${encodeURIComponent(orgId)}`)
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'アカウント情報の取得に失敗しました')
      return json as AccountResponse
    },
    enabled: !!orgId,
    // STRUCTUREティア(設定・接続構成): 実質固定だがwebhook起点の変化を陳腐化させないため
    // Infinityにはせず、mount時のサイレントSWR(背景refetch)は効かせる(freshness tiers)。
    staleTime: 5 * 60_000,
  })

  const setStatus = useCallback(
    async (accountId: string, status: 'active' | 'disabled') => {
      const previous = queryClient.getQueryData<AccountResponse>(queryKey)

      // Optimistic update: トグルは即時反映(保存ボタン無し)
      queryClient.setQueryData<AccountResponse>(queryKey, (old) =>
        old?.account
          ? { ...old, account: { ...old.account, status } }
          : old,
      )

      try {
        const response = await fetch('/api/channels/accounts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, status }),
        })
        const json = await response.json()
        if (!response.ok) throw new Error(json.error ?? '更新に失敗しました')

        queryClient.setQueryData<AccountResponse>(queryKey, (old) =>
          old ? { ...old, account: json.account as ChannelAccountMeta } : old,
        )
      } catch (err) {
        // ロールバック
        if (previous) queryClient.setQueryData(queryKey, previous)
        throw err
      }
    },
    [queryClient, queryKey],
  )

  return {
    account: data?.account ?? null,
    sharedBotInUse: data?.sharedBotInUse ?? false,
    viewerRole: data?.viewerRole ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    setStatus,
  }
}
