'use client'

import { useState, useEffect, useCallback } from 'react'
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

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const supabase = createClient()

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (userError || !user) {
        setNotifications([])
        setLoading(false)
        return
      }

      // Fetch in-app notifications for the user
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: fetchError } = await (supabase as any)
        .from('notifications')
        .select('*')
        .eq('to_user_id', user.id)
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
  }, [])

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      const supabase = createClient()

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
  }, [])

  const markAllAsRead = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('to_user_id', user.id)
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
  }, [])

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
