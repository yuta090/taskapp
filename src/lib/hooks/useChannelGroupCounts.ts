'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * space毎の active な channel_groups（グループ接続）件数。
 *
 * 秘書コンソールの「連携済み/未連携」判定は 1:1DM の channel_identities だけでなく
 * グループ接続でも“連携済み”とする必要がある（Freeは相手先をグループ単位で繋ぐため、
 * identityが無くてもグループがあれば送信できる＝入力欄を有効化すべき）。
 * channel_groups はRLSで内部メンバーにSELECTが許可されているため、
 * useChannelIdentities.ts と同様に直接Supabaseクエリで集計する（新規APIルートは作らない）。
 */
export function useChannelGroupCounts(orgId: string) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient

  const queryKey = useMemo(() => ['channelGroupCounts', orgId] as const, [orgId])

  const { data, isLoading, error } = useQuery<Record<string, number>>({
    queryKey,
    queryFn: async (): Promise<Record<string, number>> => {
      if (!orgId) return {}

      const { data, error } = await supabase
        .from('channel_groups')
        .select('space_id')
        .eq('org_id', orgId)
        .eq('status', 'active')

      if (error) throw error

      const counts: Record<string, number> = {}
      for (const row of (data ?? []) as { space_id: string | null }[]) {
        // 未紐付け(space_id=null)のグループは相手先に結びつかないため数えない
        if (!row.space_id) continue
        counts[row.space_id] = (counts[row.space_id] ?? 0) + 1
      }
      return counts
    },
    enabled: !!orgId,
    staleTime: 30_000,
  })

  return {
    counts: data ?? {},
    isLoading,
    error: error instanceof Error ? error.message : null,
  }
}
