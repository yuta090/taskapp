'use client'

import { useCallback, useContext, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ACTIONABLE_TYPES_ARRAY } from '@/lib/notifications/classify'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

export interface UnreadNotificationCountState {
  count: number          // 純粋な未読数
  pendingCount: number   // 未読 + 既読未対応 = 注意が必要な総数
  loading: boolean
  error: string | null
  refresh: () => void
}

interface CountQueryData {
  count: number
  pendingCount: number
}

export function useUnreadNotificationCount(): UnreadNotificationCountState {
  const queryClient = useQueryClient()
  const { activeOrgId, loading: orgLoading } = useContext(ActiveOrgContext)

  // Supabase client を useRef で安定化
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = useMemo(() => ['unreadCount', activeOrgId] as const, [activeOrgId])

  const { data, isLoading, error: queryError } = useQuery<CountQueryData>({
    queryKey,
    queryFn: async (): Promise<CountQueryData> => {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (userError || !user) {
        return { count: 0, pendingCount: 0 }
      }

      // Build base queries with optional org filter
      let unreadQuery = (supabase as SupabaseClient)
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('to_user_id', user.id)
        .eq('channel', 'in_app')
        .is('read_at', null)

      let pendingQuery = (supabase as SupabaseClient)
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('to_user_id', user.id)
        .eq('channel', 'in_app')
        .is('actioned_at', null)
        .in('type', ACTIONABLE_TYPES_ARRAY)

      if (activeOrgId) {
        unreadQuery = unreadQuery.eq('org_id', activeOrgId)
        pendingQuery = pendingQuery.eq('org_id', activeOrgId)
      }

      // Parallel: unread count + actionable-not-actioned count
      const [unreadResult, pendingResult] = await Promise.all([
        unreadQuery,
        pendingQuery,
      ])

      if (unreadResult.error) throw unreadResult.error
      if (pendingResult.error) throw pendingResult.error

      return {
        count: unreadResult.count ?? 0,
        pendingCount: pendingResult.count ?? 0,
      }
    },
    staleTime: 30_000,
    enabled: !orgLoading,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    count: data?.count ?? 0,
    pendingCount: data?.pendingCount ?? 0,
    loading: isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : '通知件数の取得に失敗しました') : null,
    refresh,
  }
}
