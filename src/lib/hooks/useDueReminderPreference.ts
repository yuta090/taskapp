'use client'

import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface UseDueReminderPreferenceResult {
  enabled: boolean
  toggle: () => Promise<void>
  saving: boolean
  loading: boolean
}

const DEFAULT_ENABLED = true

/**
 * 秘書からの期限リマインド（自動 due-reminder）を本人が受け取るかの受信可否
 * (profiles.due_reminder_enabled)。sender / channel-digest が送信直前に参照し
 * false なら送らない＝実際に効く設定。
 *
 * 取得は react-query に載せる（queryKey=['dueReminderPreference', userId]）。
 * これにより QueryProvider の永続キャッシュ(IndexedDB)に乗り、設定ページを開くたびの
 * コールド往復（フルスクリーンspinner）を避ける。トグルは楽観更新（キャッシュを即書換え）
 * → upsert 失敗時はロールバック。保存ボタンは無い（規約）。RLS は既存の
 * "Users can update own profile"（自分の行のみ）に委ねる。
 *
 * 初期値をサーバ側で取得済みの画面（例: portal/settings）は prop 受け渡し型の
 * useReminderPreference を使う。こちらは client 単独ページ用に自己取得する。
 */
export function useDueReminderPreference(userId?: string): UseDueReminderPreferenceResult {
  const queryClient = useQueryClient()
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const [saving, setSaving] = useState(false)
  const queryKey = ['dueReminderPreference', userId] as const

  const { data, isLoading } = useQuery<boolean>({
    queryKey,
    enabled: !!userId,
    // 設定トグルは低頻度更新。設定系の姉妹hook(useChannelAccount)の STRUCTURE ティア(5分)に揃える。
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const supabase = supabaseRef.current as SupabaseClient
      const { data } = await supabase
        .from('profiles')
        .select('due_reminder_enabled')
        .eq('id', userId!)
        .maybeSingle()
      return (data as { due_reminder_enabled?: boolean | null } | null)?.due_reminder_enabled ?? DEFAULT_ENABLED
    },
  })

  const toggle = useCallback(async () => {
    if (!userId) return
    const previous = (queryClient.getQueryData<boolean>(queryKey)) ?? DEFAULT_ENABLED
    const next = !previous
    queryClient.setQueryData(queryKey, next) // 楽観更新
    setSaving(true)

    try {
      const supabase = supabaseRef.current as SupabaseClient
      // upsert (not update) — on_auth_user_created トリガー未実行で profiles 行が
      // 無い場合に update() が 0 行 no-op になるのを避ける（useReminderPreference と同流儀）。
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: userId, due_reminder_enabled: next }, { onConflict: 'id' })

      if (error) throw error
    } catch (err) {
      console.warn('Failed to persist due reminder preference:', err)
      queryClient.setQueryData(queryKey, previous) // 失敗時ロールバック
    } finally {
      setSaving(false)
    }
    // queryKey は userId 由来で安定。依存に userId のみ挙げる（配列リテラルは毎回新規のため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, queryClient])

  return {
    enabled: data ?? DEFAULT_ENABLED,
    toggle,
    saving,
    loading: isLoading,
  }
}
