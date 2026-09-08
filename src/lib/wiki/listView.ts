/**
 * Wiki 一覧の絞り込み・並べ替え・表示補助の純粋ロジック。
 * React に依存しないため単体テストしやすい形に切り出している。
 *
 * 日付は toISOString() を使わず、常に Date のローカルゲッター
 * （getFullYear/getMonth/getDate/getHours/getMinutes）で組み立てる。
 */
import type { Milestone, WikiPage } from '@/types/database'

export type WikiSortKey = 'updated_at' | 'created_at' | 'title' | 'author'
export type WikiSortDir = 'asc' | 'desc'

export interface WikiListFilters {
  /** タイトル・タグの部分一致（大文字小文字・全角半角の区別なし） */
  query: string
  /** AND 条件（選んだタグを全部持つページ） */
  tags: string[]
  /** created_by が含まれるページ */
  authorIds: string[]
}

export interface WikiListSort {
  key: WikiSortKey
  dir: WikiSortDir
}

export const DEFAULT_WIKI_FILTERS: WikiListFilters = {
  query: '',
  tags: [],
  authorIds: [],
}

export const DEFAULT_WIKI_SORT: WikiListSort = {
  key: 'updated_at',
  dir: 'desc',
}

/** 全角/半角・大文字小文字を区別しない検索用に正規化する。 */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function isDefaultFilters(filters: WikiListFilters): boolean {
  return filters.query.trim() === '' && filters.tags.length === 0 && filters.authorIds.length === 0
}

/** タグの使用件数を多い順→名前順（ja）で集計する。 */
export function collectWikiTags(pages: WikiPage[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const tag of page.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'))
}

export function filterWikiPages(
  pages: WikiPage[],
  filters: WikiListFilters,
  getAuthorName: (userId: string) => string
): WikiPage[] {
  // getAuthorName は将来の「作成者名でも検索」拡張に備えたシグネチャ。現状は未使用。
  void getAuthorName

  if (pages.length === 0 || isDefaultFilters(filters)) return pages

  const normalizedQuery = normalizeForSearch(filters.query.trim())

  return pages.filter(page => {
    if (normalizedQuery) {
      const titleMatch = normalizeForSearch(page.title).includes(normalizedQuery)
      const tagMatch = page.tags.some(tag => normalizeForSearch(tag).includes(normalizedQuery))
      if (!titleMatch && !tagMatch) return false
    }

    if (filters.tags.length > 0) {
      const pageTags = new Set(page.tags)
      if (!filters.tags.every(tag => pageTags.has(tag))) return false
    }

    if (filters.authorIds.length > 0 && !filters.authorIds.includes(page.created_by)) {
      return false
    }

    return true
  })
}

export function sortWikiPages(
  pages: WikiPage[],
  sort: WikiListSort,
  getAuthorName: (userId: string) => string
): WikiPage[] {
  if (pages.length === 0) return pages

  const dirMul = sort.dir === 'asc' ? 1 : -1

  return [...pages].sort((a, b) => {
    switch (sort.key) {
      case 'title':
        return a.title.localeCompare(b.title, 'ja') * dirMul
      case 'author': {
        const nameA = getAuthorName(a.created_by)
        const nameB = getAuthorName(b.created_by)
        const cmp = nameA.localeCompare(nameB, 'ja')
        if (cmp !== 0) return cmp * dirMul
        // 名前が同じ場合は常に updated_at desc（並べ替え方向に関わらず固定）
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }
      case 'created_at':
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dirMul
      case 'updated_at':
      default:
        return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * dirMul
    }
  })
}

/**
 * ピン留め（pinned_at 非 NULL）を常に先頭（pinned_at 昇順）に固定し、
 * 残りを通常の並べ替えに従わせる。絞り込み後の配列に対して適用するため、
 * 絞り込みで除外されたピン留めページは先頭に出てこない。
 */
function applyPinning(
  filtered: WikiPage[],
  sort: WikiListSort,
  getAuthorName: (userId: string) => string
): WikiPage[] {
  const pinned = filtered.filter(p => p.pinned_at != null)
  if (pinned.length === 0) return sortWikiPages(filtered, sort, getAuthorName)

  const pinnedSorted = [...pinned].sort(
    (a, b) => new Date(a.pinned_at as string).getTime() - new Date(b.pinned_at as string).getTime()
  )
  const rest = sortWikiPages(filtered.filter(p => p.pinned_at == null), sort, getAuthorName)
  return [...pinnedSorted, ...rest]
}

export function applyWikiListView(
  pages: WikiPage[],
  filters: WikiListFilters,
  sort: WikiListSort,
  getAuthorName: (userId: string) => string
): WikiPage[] {
  const filtered = filterWikiPages(pages, filters, getAuthorName)
  return applyPinning(filtered, sort, getAuthorName)
}

/** 相対時刻表示（「たった今」「N分前」…「M/D」）。既存 WikiPageRow.formatDate を移設。 */
export function formatWikiRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  if (diffHour < 24) return `${diffHour}時間前`
  if (diffDay < 7) return `${diffDay}日前`
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

/** 絶対時刻表示（'YYYY/M/D H:mm'、ローカル時刻）。toISOString は使わない。 */
export function formatWikiAbsoluteTime(iso: string): string {
  const date = new Date(iso)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hours}:${minutes}`
}

/** 短い日付表示（「9/5」）。「作成 9/5」のような行内メタ表示に使う。 */
export function formatWikiShortDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// ---------------------------------------------------------------------------
// PR2: 構造（フォルダ・マイルストーン別表示）
// ---------------------------------------------------------------------------

export type WikiViewMode = 'list' | 'folder' | 'milestone'

export interface WikiTreeNode {
  page: WikiPage
  children: WikiTreeNode[]
  depth: number
}

/** 同一階層内の並び順: sort_order 昇順（NULL は末尾）→渡された順（安定ソート）。 */
function sortSiblings(pages: WikiPage[]): WikiPage[] {
  return [...pages].sort((a, b) => {
    const aOrder = a.sort_order ?? Number.POSITIVE_INFINITY
    const bOrder = b.sort_order ?? Number.POSITIVE_INFINITY
    return aOrder - bOrder
    // sort() は安定ソートなので、同値（未指定同士含む）は渡された順のまま残る
  })
}

/**
 * ページの一覧から親子ツリーを組み立てる。
 * parent_page_id が一覧に無い（見えない・消えた）ページは根扱いにする。
 * 壊れたデータ（本来トリガーが拒否する循環）が混入していても無限ループしないよう、
 * 経路上の祖先を辿って自分自身が現れたら子として展開しない（防御的措置）。
 */
export function buildWikiTree(pages: WikiPage[]): WikiTreeNode[] {
  const byId = new Map(pages.map(p => [p.id, p]))
  const childrenByParent = new Map<string, WikiPage[]>()
  const roots: WikiPage[] = []

  for (const p of pages) {
    const parentId = p.parent_page_id
    if (parentId != null && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? []
      list.push(p)
      childrenByParent.set(parentId, list)
    } else {
      roots.push(p)
    }
  }

  const visited = new Set<string>()

  function build(page: WikiPage, depth: number, ancestry: Set<string>): WikiTreeNode {
    visited.add(page.id)
    const children = sortSiblings(childrenByParent.get(page.id) ?? [])
      .filter(child => !ancestry.has(child.id) && !visited.has(child.id)) // 循環防止（防御的）
      .map(child => build(child, depth + 1, new Set(ancestry).add(page.id)))
    return { page, children, depth }
  }

  const result = sortSiblings(roots).map(root => build(root, 0, new Set([root.id])))

  // 循環（P→Q→P）に巻き込まれたページはどの根からも到達できず黙って消えるため、
  // 到達しなかったページを根に昇格させて必ず表示する。
  const stranded = pages.filter(p => !visited.has(p.id))
  for (const p of sortSiblings(stranded)) {
    if (!visited.has(p.id)) result.push(build(p, 0, new Set([p.id])))
  }
  return result
}

/** ツリーを深さ優先で平坦化する。折りたたまれたノードの子孫は含めない。 */
export function flattenWikiTree(
  nodes: WikiTreeNode[],
  collapsedIds: Set<string>
): { page: WikiPage; depth: number; hasChildren: boolean; collapsed: boolean }[] {
  const result: { page: WikiPage; depth: number; hasChildren: boolean; collapsed: boolean }[] = []

  function visit(node: WikiTreeNode) {
    const hasChildren = node.children.length > 0
    const collapsed = hasChildren && collapsedIds.has(node.page.id)
    result.push({ page: node.page, depth: node.depth, hasChildren, collapsed })
    if (!collapsed) {
      for (const child of node.children) visit(child)
    }
  }

  for (const node of nodes) visit(node)
  return result
}

/**
 * 絞り込み中にツリーを崩さないよう、一致した行とその祖先だけを残す。
 * 戻り値は `pages` に含まれる元の順序を保つ（buildWikiTree 側で改めて並べ替える）。
 */
export function pruneWikiTreeToMatches(pages: WikiPage[], matchedIds: Set<string>): WikiPage[] {
  const byId = new Map(pages.map(p => [p.id, p]))
  const keep = new Set<string>()

  for (const id of matchedIds) {
    let current = byId.get(id)
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      keep.add(current.id)
      visited.add(current.id)
      current = current.parent_page_id != null ? byId.get(current.parent_page_id) : undefined
    }
  }

  return pages.filter(p => keep.has(p.id))
}

function compareMilestones(a: Milestone, b: Milestone): number {
  if (a.order_key !== b.order_key) return a.order_key - b.order_key
  const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY
  const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  return a.name.localeCompare(b.name, 'ja')
}

/**
 * ページ→所属マイルストーン一覧の解決（PR4: union）。
 * 所属 = page.milestone_id（人が選んだ主たる所属）∪ linksByPageId（そのページを参照する
 * タスクの milestone_id）。milestones に存在しない id（削除済み等）は無視する。
 * 返す配列の順序は milestones の並び順（order_key→due_date→name）で揃える。
 */
export function resolveWikiMilestones(
  pages: WikiPage[],
  linksByPageId: Map<string, string[]>,
  milestones: Milestone[]
): Map<string, Milestone[]> {
  const result = new Map<string, Milestone[]>()

  for (const page of pages) {
    const ids = new Set<string>()
    if (page.milestone_id != null) ids.add(page.milestone_id)
    for (const id of linksByPageId.get(page.id) ?? []) ids.add(id)

    // milestones の並び順を基準に走査することで、常に order_key 順の配列を返す
    const resolved = milestones.filter(m => ids.has(m.id))
    result.set(page.id, resolved)
  }

  return result
}

/**
 * 所属マイルストーンごとにグループ化する（PR4: 1ページが複数グループに出てよい）。
 * マイルストーンは order_key→due_date→name(ja) 順。所属が1つも無いページは
 * 「マイルストーン未設定」（milestone: null）として末尾にまとめる。
 * ページが 0 件のマイルストーンは出さない。
 * グループ内のページ順は渡された順をそのまま保つ（並べ替えは呼び出し側の責務）。
 */
export function groupWikiPagesByMilestone(
  pages: WikiPage[],
  milestones: Milestone[],
  milestonesByPageId: Map<string, Milestone[]>
): { milestone: Milestone | null; pages: WikiPage[] }[] {
  const byMilestoneId = new Map<string, WikiPage[]>()
  const unassigned: WikiPage[] = []

  for (const page of pages) {
    const pageMilestones = milestonesByPageId.get(page.id) ?? []
    if (pageMilestones.length === 0) {
      unassigned.push(page)
      continue
    }
    for (const milestone of pageMilestones) {
      const list = byMilestoneId.get(milestone.id) ?? []
      list.push(page)
      byMilestoneId.set(milestone.id, list)
    }
  }

  const milestoneById = new Map(milestones.map(m => [m.id, m]))
  const groups: { milestone: Milestone | null; pages: WikiPage[] }[] = Array.from(byMilestoneId.entries())
    .map(([milestoneId, groupPages]) => ({ milestone: milestoneById.get(milestoneId)!, pages: groupPages }))
    .sort((a, b) => compareMilestones(a.milestone!, b.milestone!))

  if (unassigned.length > 0) {
    groups.push({ milestone: null, pages: unassigned })
  }

  return groups
}

/**
 * milestoneId に紐づく Wiki ページを、ピン留め優先→更新日の新しい順で最大 limit 件返す。
 * milestoneId が null、または一致するページが無い場合は空配列（タスク詳細のマイルストーン
 * Wiki セクションを丸ごと隠すかどうかの判定にそのまま使える）。
 * linksByPageId を渡すと、page.milestone_id だけでなくタスク参照由来の所属も union で拾う
 * （省略時は従来どおり milestone_id だけで絞り込む）。
 */
export function pickMilestoneWikiPages(
  pages: WikiPage[],
  milestoneId: string | null,
  limit = 5,
  linksByPageId?: Map<string, string[]>
): WikiPage[] {
  if (milestoneId == null) return []

  const matched = pages.filter(
    p => p.milestone_id === milestoneId || (linksByPageId?.get(p.id)?.includes(milestoneId) ?? false)
  )
  if (matched.length === 0) return []

  const sorted = applyWikiListView(matched, DEFAULT_WIKI_FILTERS, DEFAULT_WIKI_SORT, () => '')
  return sorted.slice(0, limit)
}

/** pageId の子孫（子・孫…）の id をすべて集める。親ページの選択肢から循環候補を除くために使う。 */
export function descendantIds(pages: WikiPage[], pageId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const p of pages) {
    if (p.parent_page_id != null) {
      const list = childrenByParent.get(p.parent_page_id) ?? []
      list.push(p.id)
      childrenByParent.set(p.parent_page_id, list)
    }
  }

  const result = new Set<string>()
  const visited = new Set<string>([pageId])
  const stack = [...(childrenByParent.get(pageId) ?? [])]

  while (stack.length > 0) {
    const id = stack.pop()!
    if (visited.has(id)) continue // 循環防止（防御的）
    visited.add(id)
    result.add(id)
    stack.push(...(childrenByParent.get(id) ?? []))
  }

  return result
}
