import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { WikiListToolbar } from '@/components/wiki/WikiListToolbar'
import { DEFAULT_WIKI_FILTERS } from '@/lib/wiki/listView'
import { DEFAULT_WIKI_LIST_PREFS } from '@/lib/wiki/listPrefs'
import type { WikiPage } from '@/types/database'
import type { SpaceMember } from '@/lib/hooks/useSpaceMembers'

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
    created_by: 'u1',
    updated_by: 'u1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

const MEMBERS: SpaceMember[] = [
  { id: 'u1', displayName: '田中', avatarUrl: null, role: 'admin' },
  { id: 'u2', displayName: '鈴木', avatarUrl: null, role: 'editor' },
]

function setup(overrides: Partial<React.ComponentProps<typeof WikiListToolbar>> = {}) {
  const onFiltersChange = vi.fn()
  const onPrefsChange = vi.fn()
  const props: React.ComponentProps<typeof WikiListToolbar> = {
    pages: [page({ id: 'a', tags: ['要件', '設計'] }), page({ id: 'b', tags: ['要件'] })],
    filters: DEFAULT_WIKI_FILTERS,
    onFiltersChange,
    prefs: DEFAULT_WIKI_LIST_PREFS,
    onPrefsChange,
    members: MEMBERS,
    currentUserId: 'u1',
    totalCount: 2,
    filteredCount: 2,
    ...overrides,
  }
  render(<WikiListToolbar {...props} />)
  return { onFiltersChange, onPrefsChange }
}

describe('WikiListToolbar', () => {
  it('検索ボックスに入力すると onFiltersChange が呼ばれる', () => {
    const { onFiltersChange } = setup()
    fireEvent.change(screen.getByTestId('wiki-search'), { target: { value: 'テスト' } })
    expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_WIKI_FILTERS, query: 'テスト' })
  })

  it('タグチップをクリックするとトグルされる', () => {
    const { onFiltersChange } = setup()
    fireEvent.click(screen.getByText('要件'))
    expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_WIKI_FILTERS, tags: ['要件'] })
  })

  it('選択中のタグをもう一度クリックすると外れる', () => {
    const { onFiltersChange } = setup({ filters: { ...DEFAULT_WIKI_FILTERS, tags: ['要件'] } })
    fireEvent.click(screen.getByText('要件'))
    expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_WIKI_FILTERS, tags: [] })
  })

  it('タグが1つも無ければタグ列は出ない', () => {
    setup({ pages: [page({ tags: [] })] })
    expect(screen.queryByText('要件')).not.toBeInTheDocument()
  })

  it('並べ替えボタンの初期表示は「更新日 ↓」', () => {
    setup()
    expect(screen.getByTestId('wiki-sort-toggle')).toHaveTextContent('更新日 ↓')
  })

  it('同じ並べ替え項目を再選択すると昇順⇄降順が反転する', () => {
    const { onPrefsChange } = setup({ prefs: { ...DEFAULT_WIKI_LIST_PREFS, sort: { key: 'updated_at', dir: 'desc' } } })
    fireEvent.click(screen.getByTestId('wiki-sort-toggle'))
    fireEvent.click(within(screen.getByTestId('wiki-sort-menu')).getByText('更新日'))
    expect(onPrefsChange).toHaveBeenCalledWith({
      ...DEFAULT_WIKI_LIST_PREFS,
      sort: { key: 'updated_at', dir: 'asc' },
    })
  })

  it('別の並べ替え項目を選ぶと降順から始まる', () => {
    const { onPrefsChange } = setup({ prefs: { ...DEFAULT_WIKI_LIST_PREFS, sort: { key: 'updated_at', dir: 'desc' } } })
    fireEvent.click(screen.getByTestId('wiki-sort-toggle'))
    fireEvent.click(within(screen.getByTestId('wiki-sort-menu')).getByText('タイトル'))
    expect(onPrefsChange).toHaveBeenCalledWith({
      ...DEFAULT_WIKI_LIST_PREFS,
      sort: { key: 'title', dir: 'desc' },
    })
  })

  it('表示項目メニューでチェックを切り替えると onPrefsChange が呼ばれる', () => {
    const { onPrefsChange } = setup()
    fireEvent.click(screen.getByTestId('wiki-columns-toggle'))
    fireEvent.click(within(screen.getByTestId('wiki-columns-menu')).getByText('更新者'))
    expect(onPrefsChange).toHaveBeenCalledWith({
      ...DEFAULT_WIKI_LIST_PREFS,
      columns: [...DEFAULT_WIKI_LIST_PREFS.columns, 'updater'],
    })
  })

  it('表示項目メニューで ON の項目をクリックすると外れる', () => {
    const { onPrefsChange } = setup()
    fireEvent.click(screen.getByTestId('wiki-columns-toggle'))
    fireEvent.click(within(screen.getByTestId('wiki-columns-menu')).getByText('タグ'))
    expect(onPrefsChange).toHaveBeenCalledWith({
      ...DEFAULT_WIKI_LIST_PREFS,
      columns: DEFAULT_WIKI_LIST_PREFS.columns.filter(c => c !== 'tags'),
    })
  })

  it('絞り込み無しなら件数だけを表示する', () => {
    setup({ totalCount: 5, filteredCount: 5 })
    expect(screen.getByText('5 件')).toBeInTheDocument()
    expect(screen.queryByText('絞り込みを解除')).not.toBeInTheDocument()
  })

  it('絞り込み中は「全N件中M件」＋解除ボタンを表示する', () => {
    const { onFiltersChange } = setup({
      filters: { ...DEFAULT_WIKI_FILTERS, query: 'x' },
      totalCount: 5,
      filteredCount: 2,
    })
    expect(screen.getByText('全 5 件中 2 件')).toBeInTheDocument()
    fireEvent.click(screen.getByText('絞り込みを解除'))
    expect(onFiltersChange).toHaveBeenCalledWith(DEFAULT_WIKI_FILTERS)
  })

  it('自分のページトグルで currentUserId が authorIds に入る', () => {
    const { onFiltersChange } = setup({ currentUserId: 'u1' })
    fireEvent.click(screen.getByText('自分のページ'))
    expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_WIKI_FILTERS, authorIds: ['u1'] })
  })

  it('作成者メニューからメンバーを選ぶと authorIds に追加される', () => {
    const { onFiltersChange } = setup()
    fireEvent.click(screen.getByText('作成者'))
    fireEvent.click(within(screen.getByTestId('wiki-author-menu')).getByText('鈴木'))
    expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_WIKI_FILTERS, authorIds: ['u2'] })
  })

  it('Escape キーで並べ替えメニューが閉じる', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-sort-toggle'))
    expect(screen.getByTestId('wiki-sort-menu')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-sort-toggle')).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('wiki-sort-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('wiki-sort-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('タグが9個以上なら「他 N 個」で展開し「たたむ」で戻せる', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `t${i}`)
    setup({ pages: [page({ tags })] })
    expect(screen.queryByText('t9')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('他 2 個'))
    expect(screen.getByText('t9')).toBeInTheDocument()
    fireEvent.click(screen.getByText('たたむ'))
    expect(screen.queryByText('t9')).not.toBeInTheDocument()
  })

  it('検索ボックス・タグチップにアクセシブルな名前/状態がある', () => {
    setup({ pages: [page({ tags: ['仕様書'] })], filters: { ...DEFAULT_WIKI_FILTERS, tags: ['仕様書'] } })
    expect(screen.getByLabelText('タイトル・タグで検索')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /仕様書/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
