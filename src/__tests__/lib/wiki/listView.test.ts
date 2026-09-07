import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  DEFAULT_WIKI_FILTERS,
  DEFAULT_WIKI_SORT,
  collectWikiTags,
  filterWikiPages,
  sortWikiPages,
  applyWikiListView,
  formatWikiRelativeTime,
  formatWikiAbsoluteTime,
  formatWikiShortDate,
  normalizeForSearch,
} from '@/lib/wiki/listView'
import type { WikiPage } from '@/types/database'

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'タイトル',
    body: '',
    tags: [],
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

const AUTHOR_NAMES: Record<string, string> = {
  user1: '田中',
  user2: '鈴木',
}
const getAuthorName = (id: string) => AUTHOR_NAMES[id] ?? id

describe('normalizeForSearch', () => {
  it('NFKC正規化＋小文字化する', () => {
    expect(normalizeForSearch('ＡＢＣ')).toBe('abc')
    expect(normalizeForSearch('ABC')).toBe('abc')
  })
})

describe('filterWikiPages', () => {
  it('既定フィルターならそのまま返す（参照同一）', () => {
    const pages = [page()]
    expect(filterWikiPages(pages, DEFAULT_WIKI_FILTERS, getAuthorName)).toBe(pages)
  })

  it('空配列ならそのまま返す（参照同一）', () => {
    const pages: WikiPage[] = []
    expect(filterWikiPages(pages, { query: 'x', tags: [], authorIds: [] }, getAuthorName)).toBe(pages)
  })

  it('検索語はタイトルの部分一致（大文字小文字を区別しない）', () => {
    const pages = [page({ id: 'a', title: 'ABC Guide' }), page({ id: 'b', title: '設計メモ' })]
    const result = filterWikiPages(pages, { ...DEFAULT_WIKI_FILTERS, query: 'abc' }, getAuthorName)
    expect(result.map(p => p.id)).toEqual(['a'])
  })

  it('検索語は全角/半角を区別しない（NFKC正規化）', () => {
    const pages = [page({ id: 'a', title: 'ABC Guide' })]
    const result = filterWikiPages(pages, { ...DEFAULT_WIKI_FILTERS, query: 'ＡＢＣ' }, getAuthorName)
    expect(result.map(p => p.id)).toEqual(['a'])
  })

  it('検索語はタグにも部分一致する', () => {
    const pages = [page({ id: 'a', tags: ['要件定義'] }), page({ id: 'b', tags: [] })]
    const result = filterWikiPages(pages, { ...DEFAULT_WIKI_FILTERS, query: '要件' }, getAuthorName)
    expect(result.map(p => p.id)).toEqual(['a'])
  })

  it('タグは AND 条件（選んだタグを全部持つページだけ）', () => {
    const pages = [
      page({ id: 'a', tags: ['要件', '設計'] }),
      page({ id: 'b', tags: ['要件'] }),
      page({ id: 'c', tags: ['設計'] }),
    ]
    const result = filterWikiPages(pages, { ...DEFAULT_WIKI_FILTERS, tags: ['要件', '設計'] }, getAuthorName)
    expect(result.map(p => p.id)).toEqual(['a'])
  })

  it('作成者は created_by が含まれるものだけ', () => {
    const pages = [page({ id: 'a', created_by: 'user1' }), page({ id: 'b', created_by: 'user2' })]
    const result = filterWikiPages(pages, { ...DEFAULT_WIKI_FILTERS, authorIds: ['user2'] }, getAuthorName)
    expect(result.map(p => p.id)).toEqual(['b'])
  })
})

describe('sortWikiPages', () => {
  it('空配列ならそのまま返す（参照同一）', () => {
    const pages: WikiPage[] = []
    expect(sortWikiPages(pages, DEFAULT_WIKI_SORT, getAuthorName)).toBe(pages)
  })

  it('updated_at の昇順・降順', () => {
    const pages = [
      page({ id: 'a', updated_at: '2026-09-01T00:00:00+09:00' }),
      page({ id: 'b', updated_at: '2026-09-03T00:00:00+09:00' }),
      page({ id: 'c', updated_at: '2026-09-02T00:00:00+09:00' }),
    ]
    expect(sortWikiPages(pages, { key: 'updated_at', dir: 'desc' }, getAuthorName).map(p => p.id)).toEqual(['b', 'c', 'a'])
    expect(sortWikiPages(pages, { key: 'updated_at', dir: 'asc' }, getAuthorName).map(p => p.id)).toEqual(['a', 'c', 'b'])
  })

  it('created_at の昇順・降順', () => {
    const pages = [
      page({ id: 'a', created_at: '2026-09-01T00:00:00+09:00' }),
      page({ id: 'b', created_at: '2026-09-03T00:00:00+09:00' }),
    ]
    expect(sortWikiPages(pages, { key: 'created_at', dir: 'asc' }, getAuthorName).map(p => p.id)).toEqual(['a', 'b'])
    expect(sortWikiPages(pages, { key: 'created_at', dir: 'desc' }, getAuthorName).map(p => p.id)).toEqual(['b', 'a'])
  })

  it('タイトルは localeCompare(ja) で比較する', () => {
    const pages = [page({ id: 'a', title: 'いろは' }), page({ id: 'b', title: 'あいう' })]
    expect(sortWikiPages(pages, { key: 'title', dir: 'asc' }, getAuthorName).map(p => p.id)).toEqual(['b', 'a'])
    expect(sortWikiPages(pages, { key: 'title', dir: 'desc' }, getAuthorName).map(p => p.id)).toEqual(['a', 'b'])
  })

  it('作成者は表示名で比較し、同名なら updated_at desc になる', () => {
    // ひらがな表記にして collation の曖昧さを避ける（漢字の localeCompare は読み順にならない）
    const names: Record<string, string> = { user1: 'たなか', user2: 'すずき' }
    const nameOf = (id: string) => names[id] ?? id
    const pages = [
      page({ id: 'a', created_by: 'user2', updated_at: '2026-09-01T00:00:00+09:00' }), // すずき
      page({ id: 'b', created_by: 'user1', updated_at: '2026-09-02T00:00:00+09:00' }), // たなか（古い）
      page({ id: 'c', created_by: 'user1', updated_at: '2026-09-05T00:00:00+09:00' }), // たなか（新しい）
    ]
    // asc: すずき < たなか、同名のたなか同士は更新が新しい c が先
    expect(sortWikiPages(pages, { key: 'author', dir: 'asc' }, nameOf).map(p => p.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('applyWikiListView', () => {
  it('フィルターしてから並べ替える', () => {
    const pages = [
      page({ id: 'a', tags: ['要件'], updated_at: '2026-09-01T00:00:00+09:00' }),
      page({ id: 'b', tags: ['要件'], updated_at: '2026-09-03T00:00:00+09:00' }),
      page({ id: 'c', tags: [], updated_at: '2026-09-02T00:00:00+09:00' }),
    ]
    const result = applyWikiListView(pages, { ...DEFAULT_WIKI_FILTERS, tags: ['要件'] }, DEFAULT_WIKI_SORT, getAuthorName)
    expect(result.map(p => p.id)).toEqual(['b', 'a'])
  })
})

describe('collectWikiTags', () => {
  it('件数の多い順、同数なら名前順(ja)', () => {
    const pages = [
      page({ tags: ['A', 'B'] }),
      page({ tags: ['A'] }),
      page({ tags: ['C'] }),
    ]
    expect(collectWikiTags(pages)).toEqual([
      { tag: 'A', count: 2 },
      { tag: 'B', count: 1 },
      { tag: 'C', count: 1 },
    ])
  })

  it('タグが無いページだけなら空配列', () => {
    expect(collectWikiTags([page({ tags: [] })])).toEqual([])
  })
})

describe('formatWikiRelativeTime', () => {
  // now/iso とも明示オフセット付きの絶対時刻文字列で組み立てる（toISOString不使用・実行環境のTZに依存しない）
  it('1分未満は「たった今」', () => {
    const now = new Date('2026-09-08T10:00:00+09:00')
    const iso = '2026-09-08T09:59:30+09:00'
    expect(formatWikiRelativeTime(iso, now)).toBe('たった今')
  })

  it('60分未満は「N分前」', () => {
    const now = new Date('2026-09-08T10:00:00+09:00')
    const iso = '2026-09-08T09:30:00+09:00'
    expect(formatWikiRelativeTime(iso, now)).toBe('30分前')
  })

  it('24時間未満は「N時間前」', () => {
    const now = new Date('2026-09-08T10:00:00+09:00')
    const iso = '2026-09-08T05:00:00+09:00'
    expect(formatWikiRelativeTime(iso, now)).toBe('5時間前')
  })

  it('7日未満は「N日前」', () => {
    const now = new Date('2026-09-08T10:00:00+09:00')
    const iso = '2026-09-05T10:00:00+09:00'
    expect(formatWikiRelativeTime(iso, now)).toBe('3日前')
  })

  it('7日以上前は月/日表示（ローカル基準・TZに関わらず一貫している）', () => {
    const now = new Date(2026, 8, 20, 10, 0, 0)
    const iso = '2026-09-01T09:00:00+09:00'
    const date = new Date(iso)
    const expected = date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    expect(formatWikiRelativeTime(iso, now)).toBe(expected)
  })
})

// 日本時間の深夜 1:30 は UTC では前日 16:30。表示が「日本時間の日付」になることを
// リテラルの期待値で固定する（実装と同じゲッターで期待値を組むと、ずれても一致してしまう）。
describe('日付表示（日本時間で固定）', () => {
  const originalTz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo'
  })
  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('formatWikiAbsoluteTime は YYYY/M/D HH:mm（日本時間）', () => {
    expect(formatWikiAbsoluteTime('2026-09-05T01:30:00+09:00')).toBe('2026/9/5 01:30')
    expect(formatWikiAbsoluteTime('2026-09-04T16:30:00Z')).toBe('2026/9/5 01:30')
  })

  it('formatWikiShortDate は M/D（日本時間）で、UTC の前日にならない', () => {
    expect(formatWikiShortDate('2026-09-05T01:30:00+09:00')).toBe('9/5')
    expect(formatWikiShortDate('2026-01-01T00:10:00+09:00')).toBe('1/1')
  })
})

describe('空白だけの検索語', () => {
  it('全角/半角スペースだけなら絞り込みなし扱い（入力配列をそのまま返す）', () => {
    const pages = [
      { id: 'a', title: 'A', tags: [], created_by: 'u1', updated_by: 'u1', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', org_id: 'o', space_id: 's', body: '' },
    ] as unknown as import('@/types/database').WikiPage[]
    expect(filterWikiPages(pages, { query: '　 ', tags: [], authorIds: [] }, () => '')).toBe(pages)
  })
})
