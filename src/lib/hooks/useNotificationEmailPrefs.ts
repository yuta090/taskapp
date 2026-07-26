'use client'

import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface NotificationEmailPrefsValue {
  email_enabled: boolean
  on_task_assigned: boolean
  on_task_mentioned: boolean
  on_review_request: boolean
  on_client_response: boolean
  on_meeting_reminder: boolean
  digest_frequency: 'none' | 'daily' | 'weekly'
}

export const DEFAULT_EMAIL_PREFS: NotificationEmailPrefsValue = {
  email_enabled: true,
  on_task_assigned: true,
  on_task_mentioned: true,
  on_review_request: true,
  on_client_response: true,
  on_meeting_reminder: true,
  digest_frequency: 'daily',
}

const COLUMNS =
  'email_enabled, on_task_assigned, on_task_mentioned, on_review_request, on_client_response, on_meeting_reminder, digest_frequency'

export interface UseNotificationEmailPrefsResult {
  prefs: NotificationEmailPrefsValue
  update: (patch: Partial<NotificationEmailPrefsValue>) => Promise<void>
  saving: boolean
  loading: boolean
}

/**
 * メール通知（日次まとめ）の受信設定。notification_email_prefs（本人1行・RLS）を
 * 楽観更新する。cron(notification-digest) が送信直前に参照する＝実際に効く設定。
 * 取得は react-query（永続キャッシュ）に載せ、設定ページのコールド往復を避ける。
 * 保存ボタンは無い（規約・トグル即保存）。行が無ければ DB default（全ON・daily）扱い。
 */
export function useNotificationEmailPrefs(userId?: string): UseNotificationEmailPrefsResult {
  const queryClient = useQueryClient()
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const [saving, setSaving] = useState(false)
  const queryKey = ['notificationEmailPrefs', userId] as const

  const { data, isLoading } = useQuery<NotificationEmailPrefsValue>({
    queryKey,
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<NotificationEmailPrefsValue> => {
      const supabase = supabaseRef.current as SupabaseClient
      const { data } = await supabase
        .from('notification_email_prefs')
        .select(COLUMNS)
        .eq('user_id', userId!)
        .maybeSingle()
      return { ...DEFAULT_EMAIL_PREFS, ...(data as Partial<NotificationEmailPrefsValue> | null) }
    },
  })

  const update = useCallback(
    async (patch: Partial<NotificationEmailPrefsValue>) => {
      if (!userId) return
      const previous = queryClient.getQueryData<NotificationEmailPrefsValue>(queryKey) ?? DEFAULT_EMAIL_PREFS
      const next = { ...previous, ...patch }
      queryClient.setQueryData(queryKey, next) // 楽観更新
      setSaving(true)
      try {
        const supabase = supabaseRef.current as SupabaseClient
        // 全列を送る（部分upsertの曖昧さを避け、行が無くても確実に本人の1行を作る）
        const { error } = await supabase
          .from('notification_email_prefs')
          .upsert({ user_id: userId, ...next }, { onConflict: 'user_id' })
        if (error) throw error
      } catch (err) {
        console.warn('Failed to persist notification email prefs:', err)
        queryClient.setQueryData(queryKey, previous) // 失敗時ロールバック
      } finally {
        setSaving(false)
      }
    },
    // queryKey は userId 由来で安定。配列リテラルは毎回新規のため userId のみ依存に挙げる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, queryClient],
  )

  return {
    prefs: data ?? DEFAULT_EMAIL_PREFS,
    update,
    saving,
    loading: isLoading,
  }
}
