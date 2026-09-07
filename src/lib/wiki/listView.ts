/**
 * Wiki 一覧の絞り込み・並べ替え・表示補助の純粋ロジック。
 * React に依存しないため単体テストしやすい形に切り出している。
 *
 * 日付は toISOString() を使わず、常に Date のローカルゲッター
 * （getFullYear/getMonth/getDate/getHours/getMinutes）で組み立てる。
 */
import type { WikiPage } from '@/types/database'

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

export function applyWikiListView(
  pages: WikiPage[],
  filters: WikiListFilters,
  sort: WikiListSort,
  getAuthorName: (userId: string) => string
): WikiPage[] {
  const filtered = filterWikiPages(pages, filters, getAuthorName)
  return sortWikiPages(filtered, sort, getAuthorName)
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
