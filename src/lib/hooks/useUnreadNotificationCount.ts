'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ACTIONABLE_TYPES_ARRAY } from '@/lib/notifications/classify'
import type { SupabaseClient } from '@supabase/supabase-js'

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

  const fetchCount = async (signal?: AbortSignal) => {
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

      // Parallel: unread count + actionable-not-actioned count
      const [unreadResult, pendingResult] = await Promise.all([
        (supabase as SupabaseClient)
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('to_user_id', user.id)
          .eq('channel', 'in_app')
          .is('read_at', null),

        // 「要対応」バッジと一致する数: アクション可能 + 未対応（read/unread問わず）
        (supabase as SupabaseClient)
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('to_user_id', user.id)
          .eq('channel', 'in_app')
          .is('actioned_at', null)
          .in('type', ACTIONABLE_TYPES_ARRAY),
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
    const controller = new AbortController()
    fetchCount(controller.signal)

    return () => {
      controller.abort()
    }
  }, [])

  const refresh = () => {
    setLoading(true)
    fetchCount()
  }

  return {
    count,
    pendingCount,
    loading,
    error,
    refresh,
  }
}
