'use client'

import { useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export function orgReminderSettingsQueryKey(orgId: string | null) {
  return ['orgReminderSettings', orgId] as const
}

/**
 * 事務所単位の自動期限リマインドのオンオフ (org_channel_policy.due_reminders_enabled)。
 * 行が無い/nullはfail-open(true)＝既定有効（サーバ側の coalesce(...,true) と同じ規約・
 * migration 20260721215120）。個人単位の受信オフ(profiles.due_reminder_enabled)は別軸
 * （settings/account側）でそのまま残す。
 *
 * react-query の永続キャッシュに乗せることで、開くたびの取り直し・前回値を出せない問題を
 * 解消する。ほかの管理者も変える設定なので staleTime は長くしすぎない。
 */
export function useOrgReminderSettings(orgId: string | null) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryClient = useQueryClient()
  const queryKey = orgReminderSettingsQueryKey(orgId)

  const { data, isPending, isLoadingError } = useQuery<boolean>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('org_channel_policy')
        .select('due_reminders_enabled')
        .eq('org_id', orgId!)
        .maybeSingle()

      if (error) throw error
      const enabled = (data as { due_reminders_enabled?: boolean | null } | null)?.due_reminders_enabled
      return enabled ?? true
    },
    enabled: !!orgId,
    // ほかの管理者も変える設定なので、長時間キャッシュに居座らせない
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await (supabase as SupabaseClient).rpc('rpc_set_org_due_reminders_enabled', {
        p_org_id: orgId!,
        p_enabled: enabled,
      })
      if (error) throw error
    },
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<boolean>(queryKey)
      queryClient.setQueryData<boolean>(queryKey, enabled) // 楽観的更新（保存ボタン無し・プロジェクト規約）
      return { previous }
    },
    onError: (_err, _enabled, context) => {
      // 失敗時ロールバック
      if (context?.previous !== undefined) {
        queryClient.setQueryData<boolean>(queryKey, context.previous)
      }
    },
  })

  // 同期ガード: mutation.isPending の反映はReactの再描画を待つため、それだけでは
  // 同一tick内の連打（2回目のクリック）を弾けない。refで即座に弾く
  const togglingRef = useRef(false)
  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (togglingRef.current) return
      togglingRef.current = true
      mutation.mutate(enabled, {
        onSettled: () => {
          togglingRef.current = false
        },
      })
    },
    [mutation]
  )

  return {
    dueRemindersEnabled: data ?? true,
    // enabled:false でも isPending は true のままなので、orgId が無いときは読み込み中にしない
    dueRemindersLoading: !!orgId && isPending,
    // 初回だけ失敗(前回データが無いまま失敗)したときだけtrue。前回データがある状態で
    // 裏の取り直しだけ失敗した場合はfalseのまま（前回値を出し続けられる）
    dueRemindersFetchError: isLoadingError,
    dueRemindersSaving: mutation.isPending,
    dueRemindersSaveError: mutation.isError,
    setDueRemindersEnabled: setEnabled,
  }
}
