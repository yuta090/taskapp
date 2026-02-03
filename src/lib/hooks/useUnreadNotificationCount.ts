'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface UnreadNotificationCountState {
  count: number
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useUnreadNotificationCount(): UnreadNotificationCountState {
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCount = async (signal?: AbortSignal) => {
    try {
      const supabase = createClient()

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (userError || !user) {
        // Not logged in - return 0
        setCount(0)
        setLoading(false)
        return
      }

      if (signal?.aborted) return

      // Count unread in-app notifications
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: unreadCount, error: countError } = await (supabase as any)
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('to_user_id', user.id)
        .eq('channel', 'in_app')
        .is('read_at', null)

      if (signal?.aborted) return

      if (countError) {
        throw countError
      }

      setCount(unreadCount ?? 0)
      setError(null)
    } catch {
      if (!signal?.aborted) {
        setError('通知件数の取得に失敗しました')
        setCount(0)
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
    loading,
    error,
    refresh,
  }
}
