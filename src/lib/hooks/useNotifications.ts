'use client'

import { useEffect, useCallback, useRef, useContext, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { getCachedUser, invalidateCachedUser } from '@/lib/supabase/cached-auth'
import type { Notification, Json } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'
import { unreadCountQueryKey, type UnreadCountData } from '@/lib/hooks/useUnreadNotificationCount'

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
    // 申し送り承認依頼（Stage 2.7-B §5b）
    digest_task_id?: string
    group_name?: string
    assignee_hint?: string
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

  const { data, isPending, error: queryError } = useQuery<NotificationWithPayload[]>({
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

  const countKey = useMemo(() => unreadCountQueryKey(activeOrgId), [activeOrgId])

  // 通知ごとの「いちばん新しい書き込み」の番号。失敗した古い書き込みの巻き戻しで、あとから
  // 成功した書き込み（例: 既読 → 対応済み）を消さないために使う
  const writeSeqRef = useRef({ next: 0, latest: new Map<string, number>() })

  // 先回りの書き換えでは取得時刻を動かさない。「今取り直した」扱いにすると、ブラウザに保存してあった
  // 古い一覧が新しく見えて、しばらく取り直されなくなる
  const setList = useCallback(
    (updater: (old: NotificationWithPayload[] | undefined) => NotificationWithPayload[] | undefined) => {
      queryClient.setQueryData<NotificationWithPayload[]>(queryKey, updater, {
        updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt,
      })
    },
    [queryClient, queryKey]
  )
  const setCount = useCallback(
    (updater: (old: UnreadCountData | undefined) => UnreadCountData | undefined) => {
      queryClient.setQueryData<UnreadCountData>(countKey, updater, {
        updatedAt: queryClient.getQueryState(countKey)?.dataUpdatedAt,
      })
    },
    [queryClient, countKey]
  )

  // 保存中の書き込みの数と、全部終わったあとにやる取り直し。書き込みが重なっている間に取り直すと、
  // まだ保存中の別の書き込みの先回り表示を古い値で上書きしてしまう（「対応済み」→ 次の通知へ自動で
  // 進む、で起きる）ので、最後の1件が終わったときにまとめて1回だけ行う
  const writesRef = useRef({ inFlight: 0, refetchList: false, refetchCount: false })

  /**
   * 書き込みを始める。先回りで書き換える前に、取り直しの途中なら止める（古い一覧・件数で上書きされて、
   * 既読が戻って見えないように）。返り値は保存が終わったら必ず呼ぶ:
   * - 失敗したら、一覧も件数もサーバーの値で取り直して揃える
   * - 止めた取り直しは出し直す（止めたままだと、保存データより後に届いた通知が一覧に出ない）
   * - バッジの件数は先に直してあるので、refetchCount でなければ古い印だけ付け、次に画面へ
   *   戻ったときなどに揃える（通知を開くたびに件数を取り直さない。↓で素早く移ったときの
   *   ちらつきも防ぐ）
   */
  const beginWrite = useCallback(() => {
    const listWasFetching = queryClient.isFetching({ queryKey }) > 0
    const countWasFetching = queryClient.isFetching({ queryKey: countKey }) > 0
    void queryClient.cancelQueries({ queryKey })
    void queryClient.cancelQueries({ queryKey: countKey })
    writesRef.current.inFlight += 1

    return ({ ok, refetchCount }: { ok: boolean; refetchCount: boolean }) => {
      const writes = writesRef.current
      writes.inFlight -= 1
      writes.refetchList = writes.refetchList || !ok || listWasFetching
      writes.refetchCount = writes.refetchCount || !ok || refetchCount || countWasFetching
      if (writes.inFlight > 0) return

      const { refetchList, refetchCount: shouldRefetchCount } = writes
      writes.refetchList = false
      writes.refetchCount = false
      if (refetchList) void queryClient.invalidateQueries({ queryKey })
      void queryClient.invalidateQueries(
        shouldRefetchCount ? { queryKey: ['unreadCount'] } : { queryKey: ['unreadCount'], refetchType: 'none' }
      )
    }
  }, [queryClient, queryKey, countKey])

  /**
   * 1件ぶんの既読（と対応済み）を、サーバーの返事を待たずに画面へ反映する。未読だったなら左メニューの
   * バッジも1つ減らす。返事を待ってからだと、読んだのにバッジが残って「消えない」に見えていた。
   * 返り値は、保存に失敗したときに呼ぶ「元に戻す」。
   */
  const applyReadLocally = useCallback(
    (notificationId: string, patch: { read_at: string; actioned_at?: string }) => {
      const seq = ++writeSeqRef.current.next
      writeSeqRef.current.latest.set(notificationId, seq)
      const previous = queryClient
        .getQueryData<NotificationWithPayload[]>(queryKey)
        ?.find((n) => n.id === notificationId)
      const wasUnread = previous?.read_at === null

      setList((old) => old?.map((n) => (n.id === notificationId ? { ...n, ...patch } : n)))
      if (wasUnread) {
        setCount((old) => (old ? { ...old, count: Math.max(0, old.count - 1) } : old))
      }

      return () => {
        // あとから同じ通知に別の書き込みがあれば、そちらが新しいので戻さない
        if (writeSeqRef.current.latest.get(notificationId) !== seq) return
        if (previous) {
          const { read_at, actioned_at } = previous
          setList((old) => old?.map((n) => (n.id === notificationId ? { ...n, read_at, actioned_at } : n)))
        }
        if (wasUnread) {
          setCount((old) => (old ? { ...old, count: old.count + 1 } : old))
        }
      }
    },
    [queryClient, queryKey, setList, setCount]
  )

  const markAsRead = useCallback(async (notificationId: string) => {
    const now = new Date().toISOString()
    const endWrite = beginWrite()
    const rollback = applyReadLocally(notificationId, { read_at: now })
    try {
      const { error: updateError } = await (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: now })
        .eq('id', notificationId)

      if (updateError) throw updateError
      endWrite({ ok: true, refetchCount: false })
    } catch (err) {
      rollback()
      endWrite({ ok: false, refetchCount: true })
      console.error('Failed to mark notification as read:', err)
    }
  }, [supabase, beginWrite, applyReadLocally])

  /** Mark notification as actioned (also marks as read). Called after successful action completion. */
  const markAsActioned = useCallback(async (notificationId: string) => {
    const now = new Date().toISOString()
    const endWrite = beginWrite()
    const rollback = applyReadLocally(notificationId, { read_at: now, actioned_at: now })
    try {
      const { error: updateError } = await (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: now, actioned_at: now })
        .eq('id', notificationId)

      if (updateError) throw updateError
      // 「要対応」の件数(pendingCount)は先回りで直していないので、すぐ取り直す
      endWrite({ ok: true, refetchCount: true })
    } catch (err) {
      rollback()
      endWrite({ ok: false, refetchCount: true })
      console.error('Failed to mark notification as actioned:', err)
    }
  }, [supabase, beginWrite, applyReadLocally])

  const markAllAsRead = useCallback(async () => {
    const now = new Date().toISOString()
    const endWrite = beginWrite()
    const previousList = queryClient.getQueryData<NotificationWithPayload[]>(queryKey)
    const previousCount = queryClient.getQueryData<UnreadCountData>(countKey)
    // 1件ずつの既読の巻き戻しが、この「すべて既読」を消さないよう、全件の書き込み番号を進める
    const seq = ++writeSeqRef.current.next
    previousList?.forEach((n) => writeSeqRef.current.latest.set(n.id, seq))
    setList((old) => old?.map((n) => (n.read_at === null ? { ...n, read_at: now } : n)))
    setCount((old) => (old ? { ...old, count: 0 } : old))

    try {
      const { user, error: userError } = await getCachedUser(supabase)
      if (userError || !user) throw userError ?? new Error('ログインが必要です')

      let query = (supabase as SupabaseClient)
        .from('notifications')
        .update({ read_at: now })
        .eq('to_user_id', user.id)
        .eq('channel', 'in_app')
        .is('read_at', null)

      if (activeOrgId) {
        query = query.eq('org_id', activeOrgId)
      }

      const { error: updateError } = await query

      if (updateError) throw updateError
      endWrite({ ok: true, refetchCount: false })
    } catch (err) {
      // 押す前の一覧と件数に戻し、サーバーの値で取り直して揃える（途中で1件ずつ既読にした分も含めて）
      if (previousList) setList(() => previousList)
      if (previousCount) setCount(() => previousCount)
      endWrite({ ok: false, refetchCount: true })
      console.error('Failed to mark all notifications as read:', err)
    }
  }, [supabase, activeOrgId, queryClient, queryKey, countKey, beginWrite, setList, setCount])

  return {
    notifications,
    loading: isPending && !data,
    error: queryError ? (queryError instanceof Error ? queryError.message : '通知の取得に失敗しました') : null,
    fetchNotifications,
    markAsRead,
    markAsActioned,
    markAllAsRead,
  }
}
