'use client'

import { useState, useEffect, useContext } from 'react'
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

export function useUnreadNotificationCount(): UnreadNotificationCountState {
  const [count, setCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { activeOrgId, loading: orgLoading } = useContext(ActiveOrgContext)

  const fetchCount = async (signal?: AbortSignal, orgId?: string | null) => {
    try {
      const supabase = createClient()

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (userError || !user) {
        setCount(0)
        setPendingCount(0)
        setLoading(false)
        return
      }

      if (signal?.aborted) return

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

      if (orgId) {
        unreadQuery = unreadQuery.eq('org_id', orgId)
        pendingQuery = pendingQuery.eq('org_id', orgId)
      }

      // Parallel: unread count + actionable-not-actioned count
      const [unreadResult, pendingResult] = await Promise.all([
        unreadQuery,
        pendingQuery,
      ])

      if (signal?.aborted) return

      if (unreadResult.error) throw unreadResult.error
      if (pendingResult.error) throw pendingResult.error

      const unread = unreadResult.count ?? 0
      const actionableNotActioned = pendingResult.count ?? 0
      setCount(unread)
      setPendingCount(actionableNotActioned)
      setError(null)
    } catch {
      if (!signal?.aborted) {
        setError('通知件数の取得に失敗しました')
        setCount(0)
        setPendingCount(0)
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    // org解決前はフェッチしない（cross-org leak防止）
    if (orgLoading) return

    const controller = new AbortController()
    fetchCount(controller.signal, activeOrgId)

    return () => {
      controller.abort()
    }
  }, [activeOrgId, orgLoading])

  const refresh = () => {
    setLoading(true)
    fetchCount(undefined, activeOrgId)
  }

  return {
    count,
    pendingCount,
    loading,
    error,
    refresh,
  }
}
