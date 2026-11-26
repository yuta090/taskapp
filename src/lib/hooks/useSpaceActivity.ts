'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query/constants'
import type { ActivityRow } from '@/lib/dashboard/activity'

/**
 * ダッシュボードの「最近のアクティビティ」向けに、プロジェクトの操作の記録を新しい順に読む。
 *
 * - 読むのは DB 関数 rpc_space_activity だけ。社内メンバー以外が呼ぶと例外（Not authorized）になるので、
 *   画面側はエラー表示を出す
 * - 続きは、いま見えている一番古い行の (occurred_at, id, kind) を3つとも渡して読む。1つの更新から
 *   複数の行（状態とボールを同時に変えたなど）が同じ時刻・同じ id で出るので、時刻だけだと境目の行が落ちる
 */

type ActivityCursor = { at: string; id: number; kind: string }

export const SPACE_ACTIVITY_PAGE_SIZE = 30

export const spaceActivityQueryKey = (spaceId: string) => ['spaceActivity', spaceId] as const

// 読み込み中に毎レンダー新しい [] を作ると、呼び出し側の useMemo が毎回無効化されるため共有定数にする
const EMPTY_ROWS: ActivityRow[] = []

export interface SpaceActivityResult {
  rows: ActivityRow[]
  loading: boolean
  error: unknown
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<unknown>
}

export function useSpaceActivity(
  spaceId: string,
  /** 「最近のアクティビティ」を隠しているあいだは false を渡し、読みに行かない */
  options: { enabled: boolean }
): SpaceActivityResult {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current
  const queryClient = useQueryClient()

  // 画面を離れるとき、「もっと見る」で読んだ分を捨てて1ページ目だけ残す。react-query は古くなった
  // 無限クエリを再取得するとき、持っているページを1枚目から順に全部読み直すため（6ページなら6往復）
  useEffect(() => {
    const key = spaceActivityQueryKey(spaceId)
    return () => {
      queryClient.setQueryData<InfiniteData<ActivityRow[], ActivityCursor | null>>(key, (old) =>
        old && old.pages.length > 1
          ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) }
          : old
      )
    }
  }, [queryClient, spaceId])

  const { data, isPending, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: spaceActivityQueryKey(spaceId),
    initialPageParam: null as ActivityCursor | null,
    queryFn: async ({ pageParam }): Promise<ActivityRow[]> => {
      const { data, error } = await (supabase as SupabaseClient).rpc('rpc_space_activity', {
        p_space_id: spaceId,
        p_limit: SPACE_ACTIVITY_PAGE_SIZE,
        p_before: pageParam?.at ?? null,
        p_before_id: pageParam?.id ?? null,
        p_before_kind: pageParam?.kind ?? null,
      })
      if (error) throw error
      return (data ?? []) as ActivityRow[]
    },
    getNextPageParam: (lastPage): ActivityCursor | undefined => {
      if (lastPage.length < SPACE_ACTIVITY_PAGE_SIZE) return undefined
      const last = lastPage[lastPage.length - 1]
      return { at: last.occurred_at, id: last.id, kind: last.kind }
    },
    staleTime: DEFAULT_STALE_TIME_MS,
    enabled: !!spaceId && options.enabled,
  })

  const rows = useMemo(() => (data ? data.pages.flat() : EMPTY_ROWS), [data])

  return {
    rows,
    loading: options.enabled && isPending && !data,
    error: error ?? null,
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    fetchNextPage,
  }
}
