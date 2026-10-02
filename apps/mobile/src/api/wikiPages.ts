/**
 * プロジェクトの Wiki ページ一覧の読み取り（本文なし）。Web の useWikiPages
 * （src/lib/hooks/useWikiPages.ts）と同じ列・同じ条件。スマホは読むだけで、Web にある
 * 「空なら初期ページを自動作成」は書き込みなので移さない。見える範囲は RLS が決める（相手先は公開済みだけ）。
 */
import { collectRemainingPages, TASKS_PAGE_SIZE } from '@/lib/supabase/queries'
import type { WikiPage } from '@/types/database'
import { supabase } from './supabase'

/** 一覧に要る列（body を含まない）。Web の useWikiPages と同じ */
const WIKI_LIST_COLUMNS =
  'id, org_id, space_id, title, tags, parent_page_id, milestone_id, pinned_at, sort_order, is_folder, created_by, updated_by, created_at, updated_at'

function fetchWikiPagesPage(orgId: string, spaceId: string, from: number, to: number) {
  return supabase
    .from('wiki_pages')
    .select(WIKI_LIST_COLUMNS)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .order('updated_at', { ascending: false })
    // 同時刻の更新で range の境目の並びがずれないよう、id をタイブレークにする（会議の一覧と同じ考え方）
    .order('id', { ascending: false })
    .range(from, to)
}

/** 全件を range ページングで読み切る（1000件を超えるプロジェクトでも古いページが消えない） */
export async function fetchWikiPages(orgId: string, spaceId: string): Promise<WikiPage[]> {
  const { data, error } = await fetchWikiPagesPage(orgId, spaceId, 0, TASKS_PAGE_SIZE - 1)
  if (error) throw error
  const firstPageRows = (data || []) as unknown as WikiPage[]
  return collectRemainingPages(
    firstPageRows,
    (from, to) => fetchWikiPagesPage(orgId, spaceId, from, to) as unknown as PromiseLike<{ data: WikiPage[] | null; error: unknown }>,
    TASKS_PAGE_SIZE
  )
}
