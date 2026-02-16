'use client'

import { useEffect, useCallback, useRef, useContext, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  const queryClient = useQueryClient()
  const { activeOrgId, loading: orgLoading } = useContext(ActiveOrgContext)

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = useMemo(() => ['notifications', activeOrgId] as const, [activeOrgId])

  // 認証状態変更時にグローバルキャッシュ無効化（logout/relogin対策）
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      invalidateCachedUser()
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })
    return () => subscription.unsubscribe()
  }, [supabase, queryClient])

  const { data, isLoading, error: queryError } = useQuery<NotificationWithPayload[]>({
    queryKey,
    queryFn: async (): Promise<NotificationWithPayload[]> => {
      const { user, error: userError } = await getCachedUser(supabase)
      if (userError || !user) return []

      let query = (supabase as SupabaseClient)
        .from('notifications')
        .select('*, spaces(name)')
        .eq('to_user_id', user.id)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(50)

      if (activeOrgId) {
        query = query.eq('org_id', activeOrgId)
      }

      const { data: fetchData, error: fetchError } = await query

      if (fetchError) throw fetchError

      // Flatten joined space name into space_name field
      return (fetchData || []).map((n: NotificationWithPayload & { spaces?: { name: string } | null }) => ({
        ...n,
        space_name: n.spaces?.name ?? null,
      }))
    },
    staleTime: 30_000,
    enabled: !orgLoading,
  })

  const notifications = data ?? []

  const fetchNotifications = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      const { error: updateError } = await (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)

      if (updateError) throw updateError

      // Optimistic update in cache
      queryClient.setQueryData<NotificationWithPayload[]>(queryKey, (old) =>
        (old ?? []).map(n =>
          n.id === notificationId
            ? { ...n, read_at: new Date().toISOString() }
            : n
        )
      )
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }, [supabase, queryClient, queryKey])

  /** Mark notification as actioned (also marks as read). Called after successful action completion. */
  const markAsActioned = useCallback(async (notificationId: string) => {
    const now = new Date().toISOString()
    try {
      const { error: updateError } = await (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: now, actioned_at: now })
        .eq('id', notificationId)

      if (updateError) throw updateError

      queryClient.setQueryData<NotificationWithPayload[]>(queryKey, (old) =>
        (old ?? []).map(n =>
          n.id === notificationId
            ? { ...n, read_at: now, actioned_at: now }
            : n
        )
      )
    } catch (err) {
      console.error('Failed to mark notification as actioned:', err)
    }
  }, [supabase, queryClient, queryKey])

  const markAllAsRead = useCallback(async () => {
    try {
      const { user, error: userError } = await getCachedUser(supabase)
      if (userError || !user) return

      let query = (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('to_user_id', user.id)
        .eq('channel', 'in_app')
        .is('read_at', null)

      if (activeOrgId) {
        query = query.eq('org_id', activeOrgId)
      }

      const { error: updateError } = await query

      if (updateError) throw updateError

      // Optimistic update in cache
      queryClient.setQueryData<NotificationWithPayload[]>(queryKey, (old) =>
        (old ?? []).map(n =>
          n.read_at === null
            ? { ...n, read_at: new Date().toISOString() }
            : n
        )
      )
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err)
    }
  }, [supabase, activeOrgId, queryClient, queryKey])

  return {
    notifications,
    loading: isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : '通知の取得に失敗しました') : null,
    fetchNotifications,
    markAsRead,
    markAsActioned,
    markAllAsRead,
  }
}
