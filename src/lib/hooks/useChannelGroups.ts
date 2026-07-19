'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * sink作成フォームの「グループ絞り込み(任意)」選択肢用。
 * channel_groupsはRLSで内部メンバーにSELECTが許可されている(20260711073329_channel_groups_digest.sql)
 * ため、useChannelIdentities.tsと同様に直接Supabaseクエリで取得する（新規APIルートは作らない）。
 */
export interface ChannelGroupOption {
  id: string
  displayName: string | null
  externalGroupId: string
}

interface UseChannelGroupsOptions {
  /**
   * true の間だけ 15秒間隔でポーリングする(WAITINGティア)。グループ承認待ちを表示する
   * 「接続待ち」画面でのみ有効化する。既定は false = ポーリングなし・STRUCTUREティアの
   * 5分SWRのまま。
   */
  polling?: boolean
}

export function useChannelGroups(orgId: string, options?: UseChannelGroupsOptions) {
  const polling = options?.polling ?? false
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient

  const queryKey = useMemo(() => ['channelGroups', orgId] as const, [orgId])

  const { data, isLoading, error } = useQuery<ChannelGroupOption[]>({
    queryKey,
    queryFn: async (): Promise<ChannelGroupOption[]> => {
      if (!orgId) return []

      const { data, error } = await supabase
        .from('channel_groups')
        .select('id, display_name, external_group_id')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .order('display_name', { ascending: true })

      // グループ絞り込みは任意項目のため、取得失敗を致命的にしない（空一覧=org全体のみ選べる）
      if (error || !data) return []

      return (data as Array<{ id: string; display_name: string | null; external_group_id: string }>).map(
        (row) => ({ id: row.id, displayName: row.display_name, externalGroupId: row.external_group_id }),
      )
    },
    enabled: !!orgId,
    // STRUCTUREティア(設定・接続構成): 実質固定だがwebhook起点の変化を陳腐化させないため
    // Infinityにはせず、mount時のサイレントSWR(背景refetch)は効かせる(freshness tiers)。
    staleTime: 5 * 60_000,
    // WAITINGティア: 接続待ち画面がマウント中のみ15秒間隔でポーリングする。
    ...(polling ? { refetchInterval: 15_000 } : {}),
  })

  return {
    groups: data ?? [],
    isLoading,
    error: error instanceof Error ? error.message : null,
  }
}
