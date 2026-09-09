'use client'

import { useRef } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { spaceQueryKey } from '@/lib/supabase/queries'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * プロジェクト(spaces)の1行を取りにいく唯一の入口。
 *
 * 名前・アーカイブ状態・初期構成・会議ツール既定・代理店設定は、どれも同じ1行の別の列。
 * 以前はそれぞれが別のクエリで同じ行を取りにいっていたため、設定画面を開くだけで同じ行へ
 * 4〜6往復していた。ここに集約し、queryKey も ['space', spaceId] の1本にする。
 *
 * 列を1つ足すたびにクエリを増やさないよう select は '*'。1行なので転送量は問題にならず、
 * 「まだ本番に無い列」を読んでも undefined になるだけで、呼び出し側が既定値へ落とせる。
 */
export interface SpaceRow {
  id: string
  name: string | null
  archived_at: string | null
  archived_by: string | null
  preset_genre: string | null
  default_video_provider: string | null
  agency_mode: boolean | null
  default_margin_rate: number | null
  vendor_settings: Record<string, unknown> | null
  [key: string]: unknown
}

/**
 * プロジェクト1行の queryKey。書き込み側もこれを使って揃える。
 * 正本は `@/lib/supabase/queries`（server 側の prefetch からも使うため 'use client' の無い場所に置く）。
 */
export { spaceQueryKey } from '@/lib/supabase/queries'

/**
 * 保存した直後に、同じ行を見ている全画面へ即座に反映させる。
 * invalidate だけだと再取得が返るまで古い値が残り、改名直後に「古い名前」を
 * 要求する画面が出る（危険設定の確認入力で実際に起きた退行）。
 */
export function patchSpaceRow(
  queryClient: QueryClient,
  spaceId: string,
  patch: Partial<SpaceRow>
): void {
  queryClient.setQueryData<SpaceRow | null>(spaceQueryKey(spaceId), (prev) =>
    prev ? { ...prev, ...patch } : prev
  )
}

interface UseSpaceRowResult {
  space: SpaceRow | null
  /** まだ一度も取得できていない状態 */
  isPending: boolean
}

export function useSpaceRow(spaceId: string | null): UseSpaceRowResult {
  const supabaseRef = useRef<SupabaseClient | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient() as SupabaseClient

  const { data, isPending } = useQuery<SpaceRow | null>({
    queryKey: spaceQueryKey(spaceId),
    queryFn: async (): Promise<SpaceRow | null> => {
      // maybeSingle: 消されたプロジェクトや権限外の spaceId をURLで踏んだとき、
      // 「行が無い」をエラーにせず null で返す（無駄な再試行を繰り返さない）
      const { data, error } = await supabaseRef
        .current!.from('spaces')
        .select('*')
        .eq('id', spaceId!)
        .maybeSingle()
      if (error) throw error
      return (data as SpaceRow | null) ?? null
    },
    enabled: !!spaceId,
    // STRUCTUREティア(設定・接続構成): 実質固定だが他メンバーの変更を陳腐化させないため
    // Infinityにはせず、mount時のサイレントSWR(背景refetch)は効かせる(freshness tiers)。
    staleTime: 5 * 60_000,
  })

  return { space: data ?? null, isPending }
}
