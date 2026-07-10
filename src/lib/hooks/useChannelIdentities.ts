'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * space毎のLINE連携状態(active な channel_identities 件数)。
 * 左カラムの接続バッジ表示用。RLSで内部メンバーはSELECTできる(Stage 1実装済み)。
 */
export function useChannelIdentities(orgId: string) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient

  const queryKey = useMemo(() => ['channelIdentityCounts', orgId] as const, [orgId])

  const { data, isLoading, error } = useQuery<Record<string, number>>({
    queryKey,
    queryFn: async (): Promise<Record<string, number>> => {
      if (!orgId) return {}

      const { data, error } = await supabase
        .from('channel_identities')
        .select('space_id')
        .eq('org_id', orgId)
        .eq('status', 'active')

      if (error) throw error

      const counts: Record<string, number> = {}
      for (const row of (data ?? []) as { space_id: string }[]) {
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
