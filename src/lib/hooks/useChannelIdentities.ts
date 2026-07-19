'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

interface UseChannelIdentitiesOptions {
  /**
   * true の間だけ 15秒間隔でポーリングする(WAITINGティア)。QR/合言葉を出して相手先の
   * 友だち追加を待つ「接続待ち」画面でのみ有効化する（例: ClientLinkPanel）。
   * 既定は false = ポーリングなし・STRUCTUREティアの5分SWRのまま。
   */
  polling?: boolean
}

/**
 * space毎のチャネル連携状態(active な channel_identities 件数)。
 * 左カラムの接続バッジ表示用。RLSで内部メンバーはSELECTできる(Stage 1実装済み)。
 *
 * @param channel 指定するとそのチャネル(line/email/…)だけを数える。未指定は全チャネル合算。
 *   LINE専用ハブの接続判定など「このチャネルで繋がっているか」を見る用途では必ず指定する
 *   （未指定だと非LINE identityだけの相手先をLINE接続済みと誤判定するため）。
 * @param options.polling 接続待ち画面でのみ true を渡す(15秒ポーリング)。
 */
export function useChannelIdentities(
  orgId: string,
  channel?: string,
  options?: UseChannelIdentitiesOptions,
) {
  const polling = options?.polling ?? false
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient

  const queryKey = useMemo(
    () => ['channelIdentityCounts', orgId, channel ?? '*'] as const,
    [orgId, channel],
  )

  const { data, isLoading, error } = useQuery<Record<string, number>>({
    queryKey,
    queryFn: async (): Promise<Record<string, number>> => {
      if (!orgId) return {}

      let query = supabase
        .from('channel_identities')
        .select('space_id')
        .eq('org_id', orgId)
        .eq('status', 'active')
      if (channel) query = query.eq('channel', channel)

      const { data, error } = await query

      if (error) throw error

      const counts: Record<string, number> = {}
      for (const row of (data ?? []) as { space_id: string }[]) {
        counts[row.space_id] = (counts[row.space_id] ?? 0) + 1
      }
      return counts
    },
    enabled: !!orgId,
    // STRUCTUREティア(設定・接続構成): 実質固定だがwebhook起点の変化を陳腐化させないため
    // Infinityにはせず、mount時のサイレントSWR(背景refetch)は効かせる(freshness tiers)。
    staleTime: 5 * 60_000,
    // WAITINGティア: 接続待ち画面がマウント中のみ15秒間隔でポーリングする。
    ...(polling ? { refetchInterval: 15_000 } : {}),
  })

  return {
    counts: data ?? {},
    isLoading,
    error: error instanceof Error ? error.message : null,
  }
}
