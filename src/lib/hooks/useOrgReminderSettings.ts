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
    // 表(org_channel_policy)への直接upsertは、due_reminders_enabledだけに限定した列レベル
    // 権限とON CONFLICT DO UPDATEの組み合わせでpermission deniedになる（entitlement関連の
    // 他の列に触らせないための制限・migration 20260721215120）ため、権限判定込みのRPC経由にする
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
    // 成功・失敗いずれの後も、サーバー側の値に合わせて取り直す。onErrorのロールバックは
    // あくまで直前の値への一時的な巻き戻しで、その間にサーバー側の値がさらに変わっていることも
    // あるため、古い値をstaleTime(60秒)いっぱい出したままにしない
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
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
    // 裏の取り直しだけ失敗した場合はfalseのまま（前回値を出し続けられる）。
    // 呼び出し側はこれがtrueの間トグルを押せなくすること: 読めていないのに既定の
    // オン表示のまま操作可能にすると、実際はオフのorgに嘘の状態を見せて誤って
    // 再度オンにしてしまう事故になる
    dueRemindersFetchError: isLoadingError,
    dueRemindersSaving: mutation.isPending,
    dueRemindersSaveError: mutation.isError,
    setDueRemindersEnabled: setEnabled,
  }
}
