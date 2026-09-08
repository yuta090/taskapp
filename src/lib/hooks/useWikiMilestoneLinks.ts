'use client'

/**
 * Wiki ページ → タスク参照由来の所属マイルストーンの軽量取得（PR4）。
 * docs/spec/WIKI_LIST_SPEC.md 「PR4: 所属マイルストーンをタグのように見せる」節。
 *
 * ページの「所属マイルストーン」は page.milestone_id（人が選んだ主たる所属）と、
 * そのページを参照している（tasks.wiki_page_id = page.id）タスクの milestone_id の和集合。
 * この hook は後者（タスク参照由来）だけを返す。前者との union は listView.ts の
 * resolveWikiMilestones が担う。
 */
import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

interface UseWikiMilestoneLinksResult {
  /** pageId → milestoneId[]（重複なし）。 */
  linksByPageId: Map<string, string[]>
  loading: boolean
}

// 読み込み中に毎レンダー新しい Map を返すと、呼び出し側の useMemo/useEffect の依存が毎回変わり
// 無限ループになりうるため共有定数にする（useMilestones の EMPTY_MILESTONES と同じ理由）。
const EMPTY_LINKS: Map<string, string[]> = new Map()
const EMPTY_ROWS: WikiMilestoneLinkRecord = {}

/**
 * クエリの返り値は Map ではなく素のオブジェクトにする。
 * react-query が再取得時に「中身が同じなら前の参照を使い回す」構造共有は
 * 配列とプレーンオブジェクトにしか効かず、Map だと毎回別物になる。
 * その結果、タブに戻るたびに全行が再描画されてしまう。Map 化は下の useMemo で行う。
 */
type WikiMilestoneLinkRecord = Record<string, string[]>

interface TaskWikiMilestoneRow {
  wiki_page_id: string
  milestone_id: string
}

async function fetchWikiMilestoneLinks(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string
): Promise<WikiMilestoneLinkRecord> {
  const { data, error } = await supabase
    .from('tasks')
    .select('wiki_page_id, milestone_id')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .not('wiki_page_id', 'is', null)
    .not('milestone_id', 'is', null)
  // limit は付けない（付けると所属マイルストーンが黙って欠ける）。列は 2 つで、
  // tasks_wiki_page_id_idx（wiki_page_id is not null の部分索引）が効くため走査量は小さい。
  // スペースが数千タスク規模になったら、ページ単位で引く形に切り替える。

  if (error) throw error

  const linksByPageId: WikiMilestoneLinkRecord = {}
  for (const row of (data ?? []) as TaskWikiMilestoneRow[]) {
    const list = linksByPageId[row.wiki_page_id] ?? []
    if (!list.includes(row.milestone_id)) list.push(row.milestone_id)
    linksByPageId[row.wiki_page_id] = list
  }
  return linksByPageId
}

/**
 * 一覧(WikiPageClient)と TaskInspector の両方から同じ queryKey で呼ぶことで
 * react-query のキャッシュを共有し、往復を増やさない。
 */
export function useWikiMilestoneLinks(
  orgId: string,
  spaceId: string,
  options?: { enabled?: boolean }
): UseWikiMilestoneLinksResult {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['wikiMilestoneLinks', orgId, spaceId] as const

  const { data, isPending } = useQuery<WikiMilestoneLinkRecord>({
    queryKey,
    queryFn: () => fetchWikiMilestoneLinks(supabase as SupabaseClient, orgId, spaceId),
    // 呼び出し側が「今回は使わない」と分かっているとき（マイルストーン未設定のタスクなど）は止める。
    // queryKey は同じなのでキャッシュ共有は保たれる。
    enabled: !!orgId && !!spaceId && options?.enabled !== false,
    // staleTime は QueryProvider の既定（2分）に合わせる。
    // タスクの Wiki 紐づけ / マイルストーンは人が編集したときしか変わらない。
  })

  const rows = data ?? EMPTY_ROWS
  const linksByPageId = useMemo(() => {
    if (rows === EMPTY_ROWS) return EMPTY_LINKS
    return new Map(Object.entries(rows))
  }, [rows])

  return {
    linksByPageId,
    loading: isPending && !data,
  }
}
