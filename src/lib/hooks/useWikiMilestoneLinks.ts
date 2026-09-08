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
import { useRef } from 'react'
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

interface TaskWikiMilestoneRow {
  wiki_page_id: string
  milestone_id: string
}

async function fetchWikiMilestoneLinks(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('tasks')
    .select('wiki_page_id, milestone_id')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .not('wiki_page_id', 'is', null)
    .not('milestone_id', 'is', null)

  if (error) throw error

  const linksByPageId = new Map<string, string[]>()
  for (const row of (data ?? []) as TaskWikiMilestoneRow[]) {
    const list = linksByPageId.get(row.wiki_page_id) ?? []
    if (!list.includes(row.milestone_id)) list.push(row.milestone_id)
    linksByPageId.set(row.wiki_page_id, list)
  }
  return linksByPageId
}

/**
 * 一覧(WikiPageClient)と TaskInspector の両方から同じ queryKey で呼ぶことで
 * react-query のキャッシュを共有し、往復を増やさない。
 */
export function useWikiMilestoneLinks(orgId: string, spaceId: string): UseWikiMilestoneLinksResult {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['wikiMilestoneLinks', orgId, spaceId] as const

  const { data, isPending } = useQuery<Map<string, string[]>>({
    queryKey,
    queryFn: () => fetchWikiMilestoneLinks(supabase as SupabaseClient, orgId, spaceId),
    enabled: !!orgId && !!spaceId,
    staleTime: 30_000,
  })

  return {
    linksByPageId: data ?? EMPTY_LINKS,
    loading: isPending && !data,
  }
}
