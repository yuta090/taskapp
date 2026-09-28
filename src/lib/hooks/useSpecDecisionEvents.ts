'use client'

import { useRef } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query/constants'
import {
  DECISION_EVENT_ACTIONS,
  DECISION_EVENT_FETCH_LIMIT,
  type DecisionEventRow,
} from '@/lib/dashboard/decisions'

/**
 * ダッシュボードの「確定事項」向けに、決めたときの記録（task_events）を新しい順に読む。
 *
 * - 一覧そのものはタスクの側（useTasks が全件持っている）から作る。ここは「いつ決まったか」だけ
 * - 見える範囲は RLS（task_events_select_member）に任せる
 * - 索引 idx_task_events_space_action_recent（space_id, action, created_at desc）で、その space の
 *   決定の記録だけを新しい順に読み、件数の上限で止まる
 */

export const specDecisionEventsQueryKey = (spaceId: string) => ['specDecisionEvents', spaceId] as const

/**
 * 決定の状態（検討中 / 決定済み / 実装済み）を変えたあとに呼ぶ。次にダッシュボードを開いたときに
 * 「決まった日」を取り直させる。呼ばないと、決めた直後は日付だけが最大2分ぶん古いまま出る。
 * space が分からないところからも呼べるよう、spaceId は任意にしてある（省略すると全部を取り直す）。
 */
export function invalidateSpecDecisionEvents(queryClient: QueryClient, spaceId?: string) {
  queryClient.invalidateQueries({
    queryKey: spaceId ? specDecisionEventsQueryKey(spaceId) : ['specDecisionEvents'],
  })
}

// 読み込み中に毎レンダー新しい [] を作ると、呼び出し側の useMemo が毎回無効化されるため共有定数にする
const EMPTY_EVENTS: DecisionEventRow[] = []

export function useSpecDecisionEvents(
  spaceId: string,
  /** 「確定事項」を隠しているあいだは false を渡し、読みに行かない */
  options: { enabled: boolean }
): { events: DecisionEventRow[]; loading: boolean; error: unknown } {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data, isPending, error } = useQuery<DecisionEventRow[]>({
    queryKey: specDecisionEventsQueryKey(spaceId),
    queryFn: async () => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('task_events')
        .select('task_id, action, created_at')
        .eq('space_id', spaceId)
        .in('action', [...DECISION_EVENT_ACTIONS])
        .order('created_at', { ascending: false })
        .limit(DECISION_EVENT_FETCH_LIMIT)
      if (error) throw error
      return (data ?? []) as DecisionEventRow[]
    },
    staleTime: DEFAULT_STALE_TIME_MS,
    enabled: !!spaceId && options.enabled,
  })

  return {
    events: data ?? EMPTY_EVENTS,
    loading: options.enabled && isPending && !data,
    error: error ?? null,
  }
}
