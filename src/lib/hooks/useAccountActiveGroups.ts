'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/**
 * ある channel account（自社Slackアプリ等）に紐づく active な channel_groups の件数。
 * Slack 接続ページの案内で「承認まで済んだか（＝全手順完了）」の判定に使う。
 *
 * channel_groups は RLS で内部メンバーに SELECT が許可されている（useChannelGroups と同じ前提）。
 * 速いページの型: react-query・count のみ（行を取らない）・依存は accountId だけ。
 */
export function useAccountActiveGroups(accountId: string | undefined) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current
  const queryKey = useMemo(() => ['accountActiveGroups', accountId] as const, [accountId])

  return useQuery<number>({
    queryKey,
    enabled: !!accountId,
    // 承認直後に進み具合が変わるので短めに。PendingClaimsPanel の承認後に invalidate される想定。
    staleTime: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('channel_groups')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId!)
        .eq('status', 'active')
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })
}
