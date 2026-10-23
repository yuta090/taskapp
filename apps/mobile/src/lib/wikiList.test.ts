import { describe, expect, it } from 'vitest'
import type { WikiPage } from '@/types/database'
import { buildWikiRows } from './wikiList'

function page(over: Partial<WikiPage>): WikiPage {
  return {
    id: 'p1',
    org_id: 'o1',
    space_id: 's1',
    title: 'ページ',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: 0,
    is_folder: false,
    created_by: 'u1',
    updated_by: 'u1',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as WikiPage
}

const none = new Set<string>()

describe('buildWikiRows（検索なし）', () => {
  it('空配列は空の行', () => {
    expect(buildWikiRows([], '', none)).toEqual([])
  })

  it('フォルダを先に、それぞれ更新の新しい順に並べる', () => {
    const rows = buildWikiRows(
      [
        page({ id: 'old', updated_at: '2026-09-01T00:00:00Z' }),
        page({ id: 'new', updated_at: '2026-10-01T00:00:00Z' }),
        page({ id: 'dir', is_folder: true, updated_at: '2026-08-01T00:00:00Z' }),
      ],
      '',
      none
    )
    expect(rows.map((r) => r.page.id)).toEqual(['dir', 'new', 'old'])
  })

  it('子ページは親の下に深さつきで並び、親は isFolder・hasChildren になる', () => {
    const rows = buildWikiRows(
      [page({ id: 'parent' }), page({ id: 'child', parent_page_id: 'parent' }), page({ id: 'grand', parent_page_id: 'child' })],
      '',
      none
    )
    expect(rows.map((r) => [r.page.id, r.depth, r.hasChildren, r.isFolder])).toEqual([
      ['parent', 0, true, true],
      ['child', 1, true, true],
      ['grand', 2, false, false],
    ])
  })

  it('is_folder の空フォルダは hasChildren が false でも isFolder になる', () => {
    const [row] = buildWikiRows([page({ id: 'dir', is_folder: true })], '', none)
    expect(row).toMatchObject({ hasChildren: false, isFolder: true })
  })

  it('折りたたんだ親の子は消え、親の collapsed が true になる', () => {
    const pages = [page({ id: 'parent' }), page({ id: 'child', parent_page_id: 'parent' })]
    const rows = buildWikiRows(pages, '', new Set(['parent']))
    expect(rows.map((r) => r.page.id)).toEqual(['parent'])
    expect(rows[0].collapsed).toBe(true)
  })

  it('pinned_at があるページだけ pinned になる', () => {
    const rows = buildWikiRows(
      [page({ id: 'a', pinned_at: '2026-09-02T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }), page({ id: 'b' })],
      '',
      none
    )
    expect(rows.map((r) => [r.page.id, r.pinned])).toEqual([
      ['a', true],
      ['b', false],
    ])
  })

  it('親が一覧に無い（見えない）ページは根として出る', () => {
    const rows = buildWikiRows([page({ id: 'orphan', parent_page_id: 'missing' })], '', none)
    expect(rows.map((r) => [r.page.id, r.depth])).toEqual([['orphan', 0]])
  })

  it('循環していても落ちず、全ページが1回ずつ出る', () => {
    const rows = buildWikiRows(
      [page({ id: 'p', parent_page_id: 'q' }), page({ id: 'q', parent_page_id: 'p' })],
      '',
      none
    )
    expect(rows.map((r) => r.page.id).sort()).toEqual(['p', 'q'])
  })

  it('空白だけの検索語は検索なしと同じ', () => {
    const pages = [page({ id: 'parent' }), page({ id: 'child', parent_page_id: 'parent' })]
    expect(buildWikiRows(pages, '  ', new Set(['parent']))).toEqual(buildWikiRows(pages, '', new Set(['parent'])))
  })
})

describe('buildWikiRows（検索あり）', () => {
  const pages = [
    page({ id: 'dir', title: '議事', is_folder: true }),
    page({ id: 'hit', title: '週次の決定事項', parent_page_id: 'dir', tags: ['定例'] }),
    page({ id: 'miss', title: '雑記', parent_page_id: 'dir' }),
    page({ id: 'other', title: '別件' }),
  ]

  it('一致したページと、その祖先だけが残る', () => {
    const rows = buildWikiRows(pages, '決定', none)
    expect(rows.map((r) => [r.page.id, r.depth])).toEqual([
      ['dir', 0],
      ['hit', 1],
    ])
  })

  it('タグでも一致する', () => {
    expect(buildWikiRows(pages, '定例', none).map((r) => r.page.id)).toEqual(['dir', 'hit'])
  })

  it('全角半角・大文字小文字を区別しない', () => {
    const rows = buildWikiRows([page({ id: 'a', title: 'ＡＰＩ 仕様' })], 'api', none)
    expect(rows.map((r) => r.page.id)).toEqual(['a'])
  })

  it('検索中は折りたたみを無視して開く', () => {
    const rows = buildWikiRows(pages, '決定', new Set(['dir']))
    expect(rows.map((r) => r.page.id)).toEqual(['dir', 'hit'])
    expect(rows[0].collapsed).toBe(false)
  })

  it('検索中の行は開閉の印を持たない（押しても何も起きない行を作らない）', () => {
    const rows = buildWikiRows(pages, '決定', none)
    expect(rows.every((r) => !r.hasChildren)).toBe(true)
    // フォルダ扱いの表示（isFolder）は残る
    expect(rows[0].isFolder).toBe(true)
  })

  it('一致が無ければ空', () => {
    expect(buildWikiRows(pages, 'ありえない', none)).toEqual([])
  })
})
