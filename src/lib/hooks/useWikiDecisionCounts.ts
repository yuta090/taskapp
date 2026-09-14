'use client'

/**
 * Wiki 一覧の「確定 2/5」の印に使う、決定事項のタスクの数え上げ。
 *
 * `useWikiMilestoneLinks` に列を足す案は採らなかった。あちらは
 * `milestone_id is not null` で絞っているので、ゆるめると**その space の Wiki ページに
 * 紐づくタスクがほぼ全部**返る。同じフックを `TaskInspector` も使っているため、
 * タスクを開くたびにその量を取ることになる。いまの本番は最大の space で 57 ページなので
 * すぐ問題になる規模ではないが、共有しているキーの中身を太らせると、
 * 使う側（TaskInspector）が気づかないまま重くなる。
 *
 * こちらは一覧専用の別フックにして、`type='spec'` と `wiki_page_id is not null` の
 * 2条件で絞る。決定事項のタスクは Wiki ページに紐づくものだけなので行数は小さい
 * （2026-09-14 の本番実測: `wiki_pages` は全社61行・最大の space で57行、
 * `type='spec'` かつ `wiki_page_id` ありは0行）。列も3つしか取らない。
 * 埋め込み（関連表の同時取得）は使わない — `wiki_pages` は `spaces` への外部キーが
 * 2本あり、FK 名を書かないと本番だけで落ちる。
 */
import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildDecisionCounts,
  type DecisionCount,
  type DecisionCountsByPage,
  type SpecTaskRow,
} from '@/lib/wiki/decisionCounts'
import { collectRemainingPages, TASKS_PAGE_SIZE } from '@/lib/supabase/queries'

interface UseWikiDecisionCountsResult {
  /** pageId → { total, decided }。決定事項のタスクが無いページは入らない */
  countsByPageId: Map<string, DecisionCount>
  loading: boolean
}

// 読み込み中に毎レンダー新しい Map を返すと呼び出し側の依存が毎回変わるため共有定数にする
const EMPTY_COUNTS: Map<string, DecisionCount> = new Map()
const EMPTY_ROWS: DecisionCountsByPage = {}

/**
 * 1ページぶんを取る。`id` も取るのは、続きのページを読むときの重複除去に要るため
 * （`collectRemainingPages` の約束）。条件は tasks_wiki_page_id_idx
 * （wiki_page_id is not null の部分索引）が効く。
 */
function fetchDecisionPage(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string,
  from: number,
  to: number
) {
  return supabase
    .from('tasks')
    .select('id, wiki_page_id, decision_state')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .eq('type', 'spec')
    .not('wiki_page_id', 'is', null)
    .range(from, to)
}

async function fetchDecisionCounts(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string
): Promise<DecisionCountsByPage> {
  // range を明示せずに全件取ろうとすると、PostgREST の max_rows（1000・
  // supabase/config.toml）で**黙って打ち切られる**。印の数が実態とずれると
  // 「確定 2/5」が嘘になるので、tasks 一覧と同じ range ページングで読み切る。
  const { data, error } = await fetchDecisionPage(supabase, orgId, spaceId, 0, TASKS_PAGE_SIZE - 1)
  if (error) throw error

  const rows = await collectRemainingPages<SpecTaskRow & { id: string }>(
    (data ?? []) as (SpecTaskRow & { id: string })[],
    (from, to) => fetchDecisionPage(supabase, orgId, spaceId, from, to) as unknown as PromiseLike<{
      data: (SpecTaskRow & { id: string })[] | null
      error: unknown
    }>,
    TASKS_PAGE_SIZE
  )
  return buildDecisionCounts(rows)
}

export function useWikiDecisionCounts(
  orgId: string,
  spaceId: string,
  options?: { enabled?: boolean }
): UseWikiDecisionCountsResult {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const enabled = !!orgId && !!spaceId && options?.enabled !== false

  const { data, isPending } = useQuery<DecisionCountsByPage>({
    queryKey: ['wikiDecisionCounts', orgId, spaceId] as const,
    queryFn: () => fetchDecisionCounts(supabase as SupabaseClient, orgId, spaceId),
    enabled,
    // staleTime は QueryProvider の既定（2分）。決定の状態は人が押したときしか変わらない。
  })

  const rows = data ?? EMPTY_ROWS
  const countsByPageId = useMemo(() => {
    if (rows === EMPTY_ROWS) return EMPTY_COUNTS
    return new Map(Object.entries(rows))
  }, [rows])

  return {
    countsByPageId,
    loading: enabled && isPending && !data,
  }
}
