'use client'

import { useState, useEffect, useCallback, useRef, useContext } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCachedUser, invalidateCachedUser } from '@/lib/supabase/cached-auth'
import type { Notification, Json } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

export interface NotificationWithPayload extends Omit<Notification, 'payload'> {
  /** Set when user completes an action (approve, start work, etc.) — distinct from read_at */
  actioned_at?: string | null
  /** Joined from spaces table */
  space_name?: string | null
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
    // Scheduling reminder fields
    proposalId?: string
    reminderType?: 'expiry_24h' | 'unresponded_48h'
    expiresAt?: string
    unrespondedNames?: string
    [key: string]: Json | undefined
  }
}

export interface UseNotificationsState {
  notifications: NotificationWithPayload[]
  loading: boolean
  error: string | null
  fetchNotifications: () => Promise<void>
  markAsRead: (notificationId: string) => Promise<void>
  markAsActioned: (notificationId: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}


export function useNotifications(): UseNotificationsState {
  const [notifications, setNotifications] = useState<NotificationWithPayload[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { activeOrgId, loading: orgLoading } = useContext(ActiveOrgContext)

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // 認証状態変更時にグローバルキャッシュ無効化（logout/relogin対策）
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      invalidateCachedUser()
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  /** グローバルキャッシュ付きでユーザーIDを取得 */
  const getUserId = useCallback(async (): Promise<string | null> => {
    const { user, error: userError } = await getCachedUser(supabase)
    if (userError || !user) return null
    return user.id
  }, [supabase])

  const fetchNotifications = useCallback(async () => {
    // org解決前はフェッチしない（cross-org leak防止）
    if (orgLoading) return

    try {
      setLoading(true)

      const userId = await getUserId()
      if (!userId) {
        setNotifications([])
        setLoading(false)
        return
      }

      let query = (supabase as SupabaseClient)
        .from('notifications')
        .select('*, spaces(name)')
        .eq('to_user_id', userId)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(50)

      if (activeOrgId) {
        query = query.eq('org_id', activeOrgId)
      }

      const { data, error: fetchError } = await query

      if (fetchError) {
        throw fetchError
      }

      // Flatten joined space name into space_name field
      setNotifications(
        (data || []).map((n: NotificationWithPayload & { spaces?: { name: string } | null }) => ({
          ...n,
          space_name: n.spaces?.name ?? null,
        }))
      )
      setError(null)
    } catch (err) {
      console.error('Failed to fetch notifications:', err)
      setError('通知の取得に失敗しました')
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [supabase, getUserId, activeOrgId, orgLoading])

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
       
      const { error: updateError } = await (supabase as SupabaseClient)
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

  /** Mark notification as actioned (also marks as read). Called after successful action completion. */
  const markAsActioned = useCallback(async (notificationId: string) => {
    const now = new Date().toISOString()
    try {
      const { error: updateError } = await (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: now, actioned_at: now })
        .eq('id', notificationId)

      if (updateError) {
        throw updateError
      }

      setNotifications(prev =>
        prev.map(n =>
          n.id === notificationId
            ? { ...n, read_at: now, actioned_at: now }
            : n
        )
      )
    } catch (err) {
      console.error('Failed to mark notification as actioned:', err)
    }
  }, [supabase])

  const markAllAsRead = useCallback(async () => {
    try {
      const userId = await getUserId()
      if (!userId) return

      let query = (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('to_user_id', userId)
        .eq('channel', 'in_app')
        .is('read_at', null)

      if (activeOrgId) {
        query = query.eq('org_id', activeOrgId)
      }

      const { error: updateError } = await query

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
  }, [supabase, getUserId, activeOrgId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  return {
    notifications,
    loading,
    error,
    fetchNotifications,
    markAsRead,
    markAsActioned,
    markAllAsRead,
  }
}
