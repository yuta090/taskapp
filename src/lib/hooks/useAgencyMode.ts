'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useSpaceRow, spaceQueryKey, patchSpaceRow, type SpaceRow } from './useSpaceRow'
import { DEFAULT_VENDOR_SETTINGS } from '@/lib/supabase/queries'

export interface VendorSettings {
  show_client_name: boolean
  allow_client_comments: boolean
}

export interface AgencyModeData {
  agency_mode: boolean
  default_margin_rate: number | null
  vendor_settings: VendorSettings
}

const DEFAULT_AGENCY_DATA: AgencyModeData = {
  agency_mode: false,
  default_margin_rate: null,
  vendor_settings: DEFAULT_VENDOR_SETTINGS,
}

/**
 * 代理店モードの設定。値はプロジェクト1行（useSpaceRow）から読む。
 * 列がまだ無い（マイグレーション未適用の）DBでは undefined になるので既定値へ落とす。
 *
 * 書き込み先はフィールドごとに分かれる: agency_mode は spaces の列（協力会社の画面が
 * agency_mode だけを見るため残す）、default_margin_rate・vendor_settings は社内専用の
 * 別表 space_agency_settings（space_id が主キー・spaces と1:1）へ upsert する。
 */
export function useAgencyMode(spaceId: string | null) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryClient = useQueryClient()
  const { space, isPending } = useSpaceRow(spaceId)

  const mutation = useMutation({
    mutationFn: async (updates: Partial<AgencyModeData>) => {
      const { agency_mode, ...agencySettingsUpdates } = updates

      if (agency_mode !== undefined) {
        const { error } = await (supabase as SupabaseClient)
          .from('spaces')
          .update({ agency_mode })
          .eq('id', spaceId!)
        if (error) throw error
      }

      if (Object.keys(agencySettingsUpdates).length > 0) {
        const { error } = await (supabase as SupabaseClient)
          .from('space_agency_settings')
          .upsert({ space_id: spaceId!, ...agencySettingsUpdates }, { onConflict: 'space_id' })
        if (error) throw error
      }
    },
    onMutate: async (updates) => {
      const queryKey = spaceQueryKey(spaceId)
      await queryClient.cancelQueries({ queryKey })
      // 控えるのは「これから触る列」の旧値だけ。行スナップショットを丸ごと控えると、
      // 保存が失敗するまでの間に入った改名など別の列の更新まで巻き戻ってしまう
      const row = queryClient.getQueryData<SpaceRow | null>(queryKey)
      const previousColumns: Partial<SpaceRow> = {}
      for (const column of Object.keys(updates)) {
        previousColumns[column] = row ? row[column] : undefined
      }
      if (spaceId) patchSpaceRow(queryClient, spaceId, updates as Partial<SpaceRow>)
      return { previousColumns }
    },
    onError: (_err, _updates, context) => {
      if (spaceId && context?.previousColumns) {
        patchSpaceRow(queryClient, spaceId, context.previousColumns)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: spaceQueryKey(spaceId) })
    },
  })

  const data: AgencyModeData = space
    ? {
        agency_mode: (space.agency_mode as boolean | null) ?? false,
        default_margin_rate: (space.default_margin_rate as number | null) ?? null,
        vendor_settings: {
          ...DEFAULT_VENDOR_SETTINGS,
          ...((space.vendor_settings as Partial<VendorSettings> | null) ?? {}),
        },
      }
    : DEFAULT_AGENCY_DATA

  return {
    data,
    // enabled:false でも isPending は true のままなので、spaceId が無いときは読み込み中にしない
    loading: !!spaceId && isPending,
    update: mutation.mutateAsync,
  }
}
