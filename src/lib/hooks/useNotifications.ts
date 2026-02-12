'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Notification, Json } from '@/types/database'

export interface NotificationWithPayload extends Omit<Notification, 'payload'> {
  payload: {
    title?: string
    message?: string
    task_id?: string
    task_title?: string
    meeting_id?: string
    meeting_title?: string
    from_user_name?: string
    comment?: string
    question?: string
    link?: string
    urgent?: boolean
    due_date?: string
    scheduled_at?: string
    spec_path?: string
    // Meeting ended notification fields (AT-003, AT-004)
    summary_subject?: string
    summary_body?: string
    decided_count?: number
    open_count?: number
    ball_client_count?: number
    [key: string]: Json | undefined
  }
}

export interface UseNotificationsState {
  notifications: NotificationWithPayload[]
  loading: boolean
  error: string | null
  fetchNotifications: () => Promise<void>
  markAsRead: (notificationId: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}

export function useNotifications(): UseNotificationsState {
  const [notifications, setNotifications] = useState<NotificationWithPayload[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // ユーザーIDキャッシュ（auth.getUser()の重複呼び出し回避）
  const userIdRef = useRef<string | null>(null)

  // 認証状態変更時にキャッシュ無効化（logout/relogin対策）
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      userIdRef.current = null
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  /** キャッシュ付きでユーザーIDを取得 */
  const getUserId = useCallback(async (): Promise<string | null> => {
    if (userIdRef.current) return userIdRef.current
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return null
    userIdRef.current = user.id
    return user.id
  }, [supabase])

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true)

      const userId = await getUserId()
      if (!userId) {
        setNotifications([])
        setLoading(false)
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: fetchError } = await (supabase as any)
        .from('notifications')
        .select('*')
        .eq('to_user_id', userId)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(50)

      if (fetchError) {
        throw fetchError
      }

      setNotifications(data || [])
      setError(null)
    } catch (err) {
      console.error('Failed to fetch notifications:', err)
      setError('通知の取得に失敗しました')
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [supabase, getUserId])

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)

      if (updateError) {
        throw updateError
      }

      // Update local state
      setNotifications(prev =>
        prev.map(n =>
          n.id === notificationId
            ? { ...n, read_at: new Date().toISOString() }
            : n
        )
      )
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }, [supabase])

  const markAllAsRead = useCallback(async () => {
    try {
      const userId = await getUserId()
      if (!userId) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('to_user_id', userId)
        .eq('channel', 'in_app')
        .is('read_at', null)

      if (updateError) {
        throw updateError
      }

      // Update local state
      setNotifications(prev =>
        prev.map(n =>
          n.read_at === null
            ? { ...n, read_at: new Date().toISOString() }
            : n
        )
      )
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err)
    }
  }, [supabase, getUserId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  return {
    notifications,
    loading,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  }
}
