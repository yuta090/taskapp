'use client'

/**
 * Wiki のページ情報に出す「このページを参照しているタスク」の取得。
 * 組み立て（重複まとめ・並び順）は `@/lib/wiki/referencingTasks`。
 *
 * `useWikiMilestoneLinks` / `useWikiDecisionCounts` のようにスペース全体を1回で取る形は採らなかった。
 * 説明文のリンクはページごとに探すしかなく（ilike）、スペース全体で引くと全タスクの説明文を読むことになる。
 * 開いている1ページぶんだけを、2本並列で取る。
 *  1. 仕様書連携: `wiki_page_id = ページ`。tasks_wiki_page_id_idx が効く
 *  2. 説明文のリンク: `description ilike '%wiki?page=<id>%'`。索引は効かないが、
 *     org_id・space_id で絞った中を読むだけなので、ページを開くたびに1回走らせても重くない
 * 新しい DB 関数・索引は作らない。スペースのタスクが数万件規模になって重くなったら、
 * 2 を外すか、説明文の全文検索用の索引を検討する。
 *
 * 見える行は tasks の RLS（データベース側で、そのスペースのメンバーにだけ行を見せる仕組み）に任せる。
 */
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mergeReferencingTasks,
  REFERENCING_TASK_COLUMNS,
  REFERENCING_TASKS_LIMIT,
  wikiPageLinkPattern,
  type ReferencingTaskRow,
} from '@/lib/wiki/referencingTasks'

interface UseWikiPageReferencingTasksResult {
  tasks: ReferencingTaskRow[]
  loading: boolean
  error: Error | null
}

// 読み込み中に毎レンダー新しい配列を返すと、呼び出し側の useMemo/useEffect の依存が毎回変わるため共有定数にする
const EMPTY_TASKS: ReferencingTaskRow[] = []

function baseQuery(supabase: SupabaseClient, orgId: string, spaceId: string) {
  return supabase
    .from('tasks')
    .select(REFERENCING_TASK_COLUMNS)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
}

async function fetchReferencingTasks(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string,
  pageId: string
): Promise<ReferencingTaskRow[]> {
  // 上限で切るときに新しいタスクが残るよう、番号の新しい順で取る
  const [linked, described] = await Promise.all([
    baseQuery(supabase, orgId, spaceId)
      .eq('wiki_page_id', pageId)
      .order('short_id', { ascending: false })
      .limit(REFERENCING_TASKS_LIMIT),
    baseQuery(supabase, orgId, spaceId)
      .ilike('description', wikiPageLinkPattern(pageId))
      .order('short_id', { ascending: false })
      .limit(REFERENCING_TASKS_LIMIT),
  ])
  if (linked.error) throw linked.error
  if (described.error) throw described.error
  return mergeReferencingTasks(
    (linked.data ?? []) as ReferencingTaskRow[],
    (described.data ?? []) as ReferencingTaskRow[]
  )
}

export function useWikiPageReferencingTasks(
  orgId: string,
  spaceId: string,
  pageId: string | null
): UseWikiPageReferencingTasksResult {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const enabled = !!orgId && !!spaceId && !!pageId

  const { data, isPending, error } = useQuery<ReferencingTaskRow[]>({
    queryKey: ['wikiPageReferencingTasks', orgId, spaceId, pageId] as const,
    queryFn: () => fetchReferencingTasks(supabase as SupabaseClient, orgId, spaceId, pageId as string),
    enabled,
    // staleTime は QueryProvider の既定（2分）。タスクの紐づけ・説明文は人が編集したときしか変わらない。
  })

  return {
    tasks: data ?? EMPTY_TASKS,
    // 止めているときは「読み込み中」にしない（呼び出し側が読み込み中の表示から抜けられなくなる）
    loading: enabled && isPending && !error,
    error: (error as Error | null) ?? null,
  }
}
