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
  buildWikiTree,
  flattenWikiTree,
  pruneWikiTreeToMatches,
  groupWikiPagesByMilestone,
  descendantIds,
  pickMilestoneWikiPages,
  resolveWikiMilestones,
} from '@/lib/wiki/listView'
import type { WikiPage, Milestone } from '@/types/database'

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'タイトル',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
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

  it('ピン留めしたページは並べ替えに関わらず常に先頭（pinned_at 昇順）', () => {
    const pages = [
      page({ id: 'a', updated_at: '2026-09-01T00:00:00+09:00' }),
      page({ id: 'b', updated_at: '2026-09-05T00:00:00+09:00', pinned_at: '2026-09-02T00:00:00+09:00' }),
      page({ id: 'c', updated_at: '2026-09-03T00:00:00+09:00', pinned_at: '2026-09-01T00:00:00+09:00' }),
    ]
    const result = applyWikiListView(pages, DEFAULT_WIKI_FILTERS, DEFAULT_WIKI_SORT, getAuthorName)
    // ピン留め(c→b、pinned_at 古い順)が先頭、残り(a)は通常の並べ替え(updated_at desc)
    expect(result.map(p => p.id)).toEqual(['c', 'b', 'a'])
  })

  it('絞り込み中でもピン留めが一致すれば先頭に残る', () => {
    const pages = [
      page({ id: 'a', tags: ['要件'], updated_at: '2026-09-01T00:00:00+09:00' }),
      page({ id: 'b', tags: ['要件'], updated_at: '2026-09-05T00:00:00+09:00', pinned_at: '2026-09-02T00:00:00+09:00' }),
      page({ id: 'c', tags: [], updated_at: '2026-09-09T00:00:00+09:00', pinned_at: '2026-09-01T00:00:00+09:00' }),
    ]
    const result = applyWikiListView(pages, { ...DEFAULT_WIKI_FILTERS, tags: ['要件'] }, DEFAULT_WIKI_SORT, getAuthorName)
    // c はタグ不一致で除外される。残った a, b のうち b がピン留めなので先頭
    expect(result.map(p => p.id)).toEqual(['b', 'a'])
  })

  it('ピン留めが無ければ従来どおりの並べ替え結果を返す', () => {
    const pages = [page({ id: 'a' })]
    expect(applyWikiListView(pages, DEFAULT_WIKI_FILTERS, DEFAULT_WIKI_SORT, getAuthorName)).toEqual(pages)
  })
})

describe('buildWikiTree', () => {
  it('親を持たないページは根になる', () => {
    const pages = [page({ id: 'a' }), page({ id: 'b' })]
    const tree = buildWikiTree(pages)
    expect(tree.map(n => n.page.id)).toEqual(['a', 'b'])
    expect(tree.every(n => n.depth === 0 && n.children.length === 0)).toBe(true)
  })

  it('parent_page_id で親子関係を作る', () => {
    const pages = [
      page({ id: 'parent' }),
      page({ id: 'child', parent_page_id: 'parent' }),
      page({ id: 'grandchild', parent_page_id: 'child' }),
    ]
    const tree = buildWikiTree(pages)
    expect(tree).toHaveLength(1)
    expect(tree[0].page.id).toBe('parent')
    expect(tree[0].depth).toBe(0)
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].page.id).toBe('child')
    expect(tree[0].children[0].depth).toBe(1)
    expect(tree[0].children[0].children[0].page.id).toBe('grandchild')
    expect(tree[0].children[0].children[0].depth).toBe(2)
  })

  it('親が一覧に無い（見えない・消えた）ページは根扱いになる', () => {
    const pages = [page({ id: 'orphan', parent_page_id: 'missing-parent' })]
    const tree = buildWikiTree(pages)
    expect(tree.map(n => n.page.id)).toEqual(['orphan'])
    expect(tree[0].depth).toBe(0)
  })

  it('同階層内は sort_order 昇順、同値/未指定は渡された順', () => {
    const pages = [
      page({ id: 'a', sort_order: null }),
      page({ id: 'b', sort_order: 1 }),
      page({ id: 'c', sort_order: null }),
      page({ id: 'd', sort_order: 0 }),
    ]
    const tree = buildWikiTree(pages)
    expect(tree.map(n => n.page.id)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('循環データが混在していても無限ループしない（フォールバックで打ち切る）', () => {
    // トリガーで通常は作れないが、防御的に壊れたデータでも落ちないことを確認する
    const pages = [
      page({ id: 'a', parent_page_id: 'b' }),
      page({ id: 'b', parent_page_id: 'a' }),
    ]
    expect(() => buildWikiTree(pages)).not.toThrow()
  })

  it('循環に巻き込まれたページも根に昇格して必ず表示される（黙って消えない）', () => {
    const pages = [
      page({ id: 'p', parent_page_id: 'q' }),
      page({ id: 'q', parent_page_id: 'p' }),
      page({ id: 'r' }),
    ]
    const tree = buildWikiTree(pages)
    const ids = new Set<string>()
    const walk = (nodes: ReturnType<typeof buildWikiTree>) => nodes.forEach(n => { ids.add(n.page.id); walk(n.children) })
    walk(tree)
    expect(ids).toEqual(new Set(['p', 'q', 'r']))
    // 各ページはツリーに1回だけ現れる
    let count = 0
    const countWalk = (nodes: ReturnType<typeof buildWikiTree>) => nodes.forEach(n => { count++; countWalk(n.children) })
    countWalk(tree)
    expect(count).toBe(3)
  })
})

describe('flattenWikiTree', () => {
  const pages = [
    page({ id: 'parent' }),
    page({ id: 'child1', parent_page_id: 'parent' }),
    page({ id: 'child2', parent_page_id: 'parent' }),
    page({ id: 'grandchild', parent_page_id: 'child1' }),
  ]

  it('折りたたみが無ければ全ノードを深さ優先で平坦化する', () => {
    const tree = buildWikiTree(pages)
    const flat = flattenWikiTree(tree, new Set())
    expect(flat.map(f => `${f.page.id}:${f.depth}`)).toEqual([
      'parent:0',
      'child1:1',
      'grandchild:2',
      'child2:1',
    ])
    expect(flat.find(f => f.page.id === 'parent')?.hasChildren).toBe(true)
    expect(flat.find(f => f.page.id === 'grandchild')?.hasChildren).toBe(false)
  })

  it('折りたたんだノードの子孫は出力から除外される', () => {
    const tree = buildWikiTree(pages)
    const flat = flattenWikiTree(tree, new Set(['child1']))
    expect(flat.map(f => f.page.id)).toEqual(['parent', 'child1', 'child2'])
    expect(flat.find(f => f.page.id === 'child1')?.collapsed).toBe(true)
  })
})

describe('pruneWikiTreeToMatches', () => {
  const pages = [
    page({ id: 'root' }),
    page({ id: 'mid', parent_page_id: 'root' }),
    page({ id: 'leaf-match', parent_page_id: 'mid' }),
    page({ id: 'leaf-nomatch', parent_page_id: 'mid' }),
    page({ id: 'unrelated' }),
  ]

  it('一致した行とその祖先だけを残す', () => {
    const result = pruneWikiTreeToMatches(pages, new Set(['leaf-match']))
    expect(result.map(p => p.id).sort()).toEqual(['leaf-match', 'mid', 'root'])
  })

  it('一致が無ければ空配列', () => {
    expect(pruneWikiTreeToMatches(pages, new Set())).toEqual([])
  })
})

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    name: 'マイルストーン1',
    start_date: null,
    due_date: null,
    order_key: 0,
    completed_at: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

describe('groupWikiPagesByMilestone', () => {
  it('milestone_id ごとにグループ化し、order_key 昇順で並べる', () => {
    const m1 = milestone({ id: 'm1', order_key: 1, name: 'B' })
    const m2 = milestone({ id: 'm2', order_key: 0, name: 'A' })
    const pages = [
      page({ id: 'a', milestone_id: 'm1' }),
      page({ id: 'b', milestone_id: 'm2' }),
    ]
    const byPageId = new Map([['a', [m1]], ['b', [m2]]])
    const groups = groupWikiPagesByMilestone(pages, [m1, m2], byPageId)
    expect(groups.map(g => g.milestone?.id)).toEqual(['m2', 'm1'])
    expect(groups[0].pages.map(p => p.id)).toEqual(['b'])
    expect(groups[1].pages.map(p => p.id)).toEqual(['a'])
  })

  it('所属が1つも無いページは末尾に milestone: null でまとまる', () => {
    const m1 = milestone({ id: 'm1' })
    const pages = [page({ id: 'a', milestone_id: null }), page({ id: 'b', milestone_id: 'm1' })]
    const byPageId = new Map([['a', []], ['b', [m1]]])
    const groups = groupWikiPagesByMilestone(pages, [m1], byPageId)
    expect(groups.map(g => g.milestone?.id ?? null)).toEqual(['m1', null])
    expect(groups[1].pages.map(p => p.id)).toEqual(['a'])
  })

  it('ページが0件のマイルストーンは出さない', () => {
    const m1 = milestone({ id: 'm1' })
    const m2 = milestone({ id: 'm2' })
    const pages = [page({ id: 'a', milestone_id: 'm1' })]
    const byPageId = new Map([['a', [m1]]])
    const groups = groupWikiPagesByMilestone(pages, [m1, m2], byPageId)
    expect(groups.map(g => g.milestone?.id)).toEqual(['m1'])
  })

  it('order_key が同じなら due_date 昇順、それも同じなら name(ja) 順', () => {
    const m1 = milestone({ id: 'm1', order_key: 0, due_date: '2026-09-10T00:00:00+09:00', name: 'いろは' })
    const m2 = milestone({ id: 'm2', order_key: 0, due_date: '2026-09-05T00:00:00+09:00', name: 'あいう' })
    const pages = [page({ id: 'a', milestone_id: 'm1' }), page({ id: 'b', milestone_id: 'm2' })]
    const byPageId = new Map([['a', [m1]], ['b', [m2]]])
    const groups = groupWikiPagesByMilestone(pages, [m1, m2], byPageId)
    expect(groups.map(g => g.milestone?.id)).toEqual(['m2', 'm1'])
  })

  it('1ページが複数グループに出てよい（所属マイルストーンが複数）', () => {
    const m1 = milestone({ id: 'm1', order_key: 0, name: 'A' })
    const m2 = milestone({ id: 'm2', order_key: 1, name: 'B' })
    const pages = [page({ id: 'a', milestone_id: 'm1' })]
    const byPageId = new Map([['a', [m1, m2]]])
    const groups = groupWikiPagesByMilestone(pages, [m1, m2], byPageId)
    expect(groups.map(g => g.milestone?.id)).toEqual(['m1', 'm2'])
    expect(groups[0].pages.map(p => p.id)).toEqual(['a'])
    expect(groups[1].pages.map(p => p.id)).toEqual(['a'])
  })

  it('延べ行数はグループごとのページ数の合計になる（重複ぶん増える）', () => {
    const m1 = milestone({ id: 'm1', order_key: 0 })
    const m2 = milestone({ id: 'm2', order_key: 1 })
    const pages = [page({ id: 'a' }), page({ id: 'b' })]
    const byPageId = new Map([
      ['a', [m1, m2]],
      ['b', [m1]],
    ])
    const groups = groupWikiPagesByMilestone(pages, [m1, m2], byPageId)
    const totalRows = groups.reduce((sum, g) => sum + g.pages.length, 0)
    expect(totalRows).toBe(3) // a は m1・m2 の2回、b は m1 の1回
  })

  it('グループ内の並びは渡された pages の順序をそのまま保つ', () => {
    const m1 = milestone({ id: 'm1' })
    const pages = [page({ id: 'b' }), page({ id: 'a' })]
    const byPageId = new Map([['b', [m1]], ['a', [m1]]])
    const groups = groupWikiPagesByMilestone(pages, [m1], byPageId)
    expect(groups[0].pages.map(p => p.id)).toEqual(['b', 'a'])
  })
})

describe('resolveWikiMilestones', () => {
  it('手動選択（milestone_id）だけの所属', () => {
    const m1 = milestone({ id: 'm1' })
    const pages = [page({ id: 'a', milestone_id: 'm1' })]
    const result = resolveWikiMilestones(pages, new Map(), [m1])
    expect(result.get('a')?.map(m => m.id)).toEqual(['m1'])
  })

  it('タスク参照だけの所属', () => {
    const m1 = milestone({ id: 'm1' })
    const pages = [page({ id: 'a', milestone_id: null })]
    const links = new Map([['a', ['m1']]])
    const result = resolveWikiMilestones(pages, links, [m1])
    expect(result.get('a')?.map(m => m.id)).toEqual(['m1'])
  })

  it('両方ある場合は和集合（重複排除）', () => {
    const m1 = milestone({ id: 'm1', order_key: 0 })
    const m2 = milestone({ id: 'm2', order_key: 1 })
    const pages = [page({ id: 'a', milestone_id: 'm1' })]
    const links = new Map([['a', ['m1', 'm2']]])
    const result = resolveWikiMilestones(pages, links, [m1, m2])
    expect(result.get('a')?.map(m => m.id)).toEqual(['m1', 'm2'])
  })

  it('どちらも無ければ空配列', () => {
    const m1 = milestone({ id: 'm1' })
    const pages = [page({ id: 'a', milestone_id: null })]
    const result = resolveWikiMilestones(pages, new Map(), [m1])
    expect(result.get('a')).toEqual([])
  })

  it('milestones に無い id（削除済み等）は無視する', () => {
    const m1 = milestone({ id: 'm1' })
    const pages = [page({ id: 'a', milestone_id: 'missing' })]
    const links = new Map([['a', ['also-missing']]])
    const result = resolveWikiMilestones(pages, links, [m1])
    expect(result.get('a')).toEqual([])
  })

  it('順序は milestones の並び順になる（links の順不同でも）', () => {
    const m1 = milestone({ id: 'm1', order_key: 0 })
    const m2 = milestone({ id: 'm2', order_key: 1 })
    const m3 = milestone({ id: 'm3', order_key: 2 })
    const pages = [page({ id: 'a', milestone_id: 'm3' })]
    const links = new Map([['a', ['m2', 'm1']]])
    const result = resolveWikiMilestones(pages, links, [m1, m2, m3])
    expect(result.get('a')?.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })
})

describe('descendantIds', () => {
  const pages = [
    page({ id: 'root' }),
    page({ id: 'child1', parent_page_id: 'root' }),
    page({ id: 'child2', parent_page_id: 'root' }),
    page({ id: 'grandchild', parent_page_id: 'child1' }),
    page({ id: 'unrelated' }),
  ]

  it('子・孫を再帰的に集める', () => {
    const result = descendantIds(pages, 'root')
    expect([...result].sort()).toEqual(['child1', 'child2', 'grandchild'])
  })

  it('子が無ければ空集合', () => {
    expect(descendantIds(pages, 'grandchild').size).toBe(0)
  })

  it('循環データがあっても無限ループしない', () => {
    const cyclic = [
      page({ id: 'a', parent_page_id: 'b' }),
      page({ id: 'b', parent_page_id: 'a' }),
    ]
    expect(() => descendantIds(cyclic, 'a')).not.toThrow()
  })
})

describe('pickMilestoneWikiPages', () => {
  it('milestoneId が null なら空配列', () => {
    const pages = [page({ id: 'p1', milestone_id: 'm1' })]
    expect(pickMilestoneWikiPages(pages, null)).toEqual([])
  })

  it('一致するページが無ければ空配列', () => {
    const pages = [page({ id: 'p1', milestone_id: 'm2' })]
    expect(pickMilestoneWikiPages(pages, 'm1')).toEqual([])
  })

  it('一致するページだけを、更新日の新しい順で返す', () => {
    const pages = [
      page({ id: 'old', milestone_id: 'm1', updated_at: '2026-09-01T00:00:00+09:00' }),
      page({ id: 'other-milestone', milestone_id: 'm2', updated_at: '2026-09-05T00:00:00+09:00' }),
      page({ id: 'new', milestone_id: 'm1', updated_at: '2026-09-03T00:00:00+09:00' }),
    ]
    const result = pickMilestoneWikiPages(pages, 'm1')
    expect(result.map(p => p.id)).toEqual(['new', 'old'])
  })

  it('ピン留めを更新日より優先して先頭に出す', () => {
    const pages = [
      page({ id: 'unpinned-new', milestone_id: 'm1', updated_at: '2026-09-05T00:00:00+09:00' }),
      page({ id: 'pinned-old', milestone_id: 'm1', updated_at: '2026-09-01T00:00:00+09:00', pinned_at: '2026-09-02T00:00:00+09:00' }),
    ]
    const result = pickMilestoneWikiPages(pages, 'm1')
    expect(result.map(p => p.id)).toEqual(['pinned-old', 'unpinned-new'])
  })

  it('6件以上あっても既定の上限5件に切り詰める', () => {
    const pages = Array.from({ length: 7 }, (_, i) =>
      page({ id: `p${i}`, milestone_id: 'm1', updated_at: `2026-09-0${(i % 9) + 1}T00:00:00+09:00` })
    )
    expect(pickMilestoneWikiPages(pages, 'm1')).toHaveLength(5)
  })

  it('limit を指定すればその件数まで返す', () => {
    const pages = Array.from({ length: 3 }, (_, i) => page({ id: `p${i}`, milestone_id: 'm1' }))
    expect(pickMilestoneWikiPages(pages, 'm1', 2)).toHaveLength(2)
  })

  it('linksByPageId を渡すとタスク参照由来の所属も拾う（union）', () => {
    const pages = [
      page({ id: 'manual', milestone_id: 'm1' }),
      page({ id: 'via-task', milestone_id: null }),
      page({ id: 'unrelated', milestone_id: 'm2' }),
    ]
    const links = new Map([['via-task', ['m1']]])
    const result = pickMilestoneWikiPages(pages, 'm1', 5, links)
    expect(result.map(p => p.id).sort()).toEqual(['manual', 'via-task'])
  })

  it('linksByPageId を省略すれば従来どおり milestone_id だけで絞り込む', () => {
    const pages = [page({ id: 'manual', milestone_id: 'm1' }), page({ id: 'via-task', milestone_id: null })]
    const result = pickMilestoneWikiPages(pages, 'm1')
    expect(result.map(p => p.id)).toEqual(['manual'])
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
