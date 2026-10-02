/**
 * Wiki 一覧の行の組み立て（純粋関数）。並べ方・絞り込み・ツリーの平坦化は Web の `@/lib/wiki/listView` を共有し、
 * ここは「検索語と折りたたみから行の配列を作る」薄い組み立てだけを持つ。
 */
import type { WikiPage } from '@/types/database'
import {
  buildWikiTree,
  DEFAULT_WIKI_FILTERS,
  filterWikiPages,
  flattenWikiTree,
  pruneWikiTreeToMatches,
  type WikiTreeNode,
} from '@/lib/wiki/listView'

export interface WikiRow {
  page: WikiPage
  depth: number
  hasChildren: boolean
  collapsed: boolean
  /** フォルダ扱い（is_folder、または子ページを持つ） */
  isFolder: boolean
  /** ピン留め中（題名の前に「ピン」の文字ラベルを出す） */
  pinned: boolean
}

/**
 * 検索語から親子ツリーを作る（重い並べ替えはここ。折りたたみの開閉では作り直さない）。
 * 検索語があれば、題名・タグが一致したページとその祖先だけを残す。
 */
export function buildWikiRowTree(pages: WikiPage[], query: string): WikiTreeNode[] {
  let visible = pages
  if (query.trim() !== '') {
    const matched = filterWikiPages(pages, { ...DEFAULT_WIKI_FILTERS, query }, () => '')
    visible = pruneWikiTreeToMatches(pages, new Set(matched.map((p) => p.id)))
  }
  return buildWikiTree(visible)
}

/**
 * ツリーを行の配列に平らにする。検索語が空ならフォルダ構造のまま（折りたたんだ親の子は出さない）。
 * 検索中は折りたたみを無視して全部開き、開閉の印は出さない（押しても何も起きない行を作らない）。
 */
export function flattenWikiRows(nodes: WikiTreeNode[], query: string, collapsedIds: Set<string>): WikiRow[] {
  const searching = query.trim() !== ''
  return flattenWikiTree(nodes, searching ? new Set() : collapsedIds).map((r) => ({
    ...r,
    isFolder: r.page.is_folder === true || r.hasChildren,
    pinned: r.page.pinned_at != null,
    hasChildren: searching ? false : r.hasChildren,
  }))
}

export function buildWikiRows(pages: WikiPage[], query: string, collapsedIds: Set<string>): WikiRow[] {
  return flattenWikiRows(buildWikiRowTree(pages, query), query, collapsedIds)
}
