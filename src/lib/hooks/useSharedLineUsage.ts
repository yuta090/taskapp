'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveLineUsage, type LineUsageView } from '@/lib/channels/metering/deriveLineUsage'

/**
 * 共通LINE(共有bot)の当月送信量を表示用に取得する。
 *
 * 裏側は実装済み（DDL変更なしで読める）:
 *   - 上限: org_channel_policy.monthly_push_quota（RLSで自org内部メンバーのみ select 可）
 *   - 送信数: rpc app_org_channel_push_usage_current_month（当月の billable 送信成功数・会員のみ）
 * 2本を並列取得し deriveLineUsage で整形する（waterfall を作らない）。
 *
 * policy 行が無い org（＝共通LINE未接続）は view=null を返す。呼び出し側はパネルを出さない。
 * これは「準備中」ではなく「そもそも接続していないので残数の概念が無い」状態。
 */
export interface SharedLineUsageResult {
  view: LineUsageView | null
  loading: boolean
  error: boolean
}

interface PolicyRow {
  monthly_push_quota: number | null
}

export function useSharedLineUsage(orgId?: string): SharedLineUsageResult {
  const supabaseRef = useRef<SupabaseClient | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient() as SupabaseClient
  const supabase = supabaseRef.current!

  const { data, isLoading, isError } = useQuery<LineUsageView | null>({
    queryKey: ['sharedLineUsage', orgId],
    enabled: !!orgId,
    // 送信数は単調増加のカウンターで秒単位の即時性は不要。60秒あれば十分に新しく、
    // 当月カウントRPCの無駄打ちも抑えられる（既定2分より短めにしているのはこの理由）。
    staleTime: 60_000,
    queryFn: async (): Promise<LineUsageView | null> => {
      const [policyRes, usageRes] = await Promise.all([
        supabase
          .from('org_channel_policy')
          .select('monthly_push_quota')
          .eq('org_id', orgId!)
          .maybeSingle(),
        supabase.rpc('app_org_channel_push_usage_current_month', { p_org: orgId! }),
      ])

      // policy 行が無い＝共通LINE未接続。残数の概念が無いのでパネルを出さない。
      if (policyRes.error || !policyRes.data) return null

      const quota = (policyRes.data as PolicyRow).monthly_push_quota
      const used = typeof usageRes.data === 'number' ? usageRes.data : 0
      return deriveLineUsage({ used, quota })
    },
  })

  return { view: data ?? null, loading: isLoading, error: isError }
}
