import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  DEFAULT_WIKI_LIST_PREFS,
  WIKI_LIST_PREFS_KEY,
  parseWikiListPrefs,
  useWikiListPrefs,
} from '@/lib/wiki/listPrefs'

beforeEach(() => {
  localStorage.clear()
})

describe('parseWikiListPrefs', () => {
  it('null なら既定値', () => {
    expect(parseWikiListPrefs(null)).toEqual(DEFAULT_WIKI_LIST_PREFS)
  })

  it('空文字なら既定値', () => {
    expect(parseWikiListPrefs('')).toEqual(DEFAULT_WIKI_LIST_PREFS)
  })

  it('壊れた JSON なら既定値', () => {
    expect(parseWikiListPrefs('{not json')).toEqual(DEFAULT_WIKI_LIST_PREFS)
  })

  it('JSON だが object でなければ既定値', () => {
    expect(parseWikiListPrefs('"just a string"')).toEqual(DEFAULT_WIKI_LIST_PREFS)
    expect(parseWikiListPrefs('123')).toEqual(DEFAULT_WIKI_LIST_PREFS)
    expect(parseWikiListPrefs('null')).toEqual(DEFAULT_WIKI_LIST_PREFS)
  })

  it('未知の列は除去し、有効な列だけ残す', () => {
    const raw = JSON.stringify({ columns: ['tags', 'bogus', 'author'], sort: { key: 'title', dir: 'asc' } })
    expect(parseWikiListPrefs(raw)).toEqual({
      columns: ['tags', 'author'],
      sort: { key: 'title', dir: 'asc' },
      view: 'list',
      collapsedIds: [],
    })
  })

  it('milestones は有効な列として残る', () => {
    const raw = JSON.stringify({ columns: ['milestones'], sort: DEFAULT_WIKI_LIST_PREFS.sort })
    expect(parseWikiListPrefs(raw).columns).toEqual(['milestones'])
  })

  it('空配列（利用者が全部 OFF にした状態）はそのまま空で復元される', () => {
    const raw = JSON.stringify({ columns: [], sort: DEFAULT_WIKI_LIST_PREFS.sort })
    expect(parseWikiListPrefs(raw).columns).toEqual([])
  })

  it('列が全部未知なら空になる（既定には戻さない）', () => {
    const raw = JSON.stringify({ columns: ['bogus1', 'bogus2'], sort: DEFAULT_WIKI_LIST_PREFS.sort })
    expect(parseWikiListPrefs(raw).columns).toEqual([])
  })

  it('未知の並べ替えキー/方向は既定に戻す', () => {
    const raw = JSON.stringify({ columns: ['tags'], sort: { key: 'bogus', dir: 'bogus' } })
    expect(parseWikiListPrefs(raw).sort).toEqual(DEFAULT_WIKI_LIST_PREFS.sort)
  })

  it('columns が配列でない場合は既定の列に戻す', () => {
    const raw = JSON.stringify({ columns: 'tags', sort: DEFAULT_WIKI_LIST_PREFS.sort })
    expect(parseWikiListPrefs(raw).columns).toEqual(DEFAULT_WIKI_LIST_PREFS.columns)
  })

  it('view の既定値は list', () => {
    expect(DEFAULT_WIKI_LIST_PREFS.view).toBe('list')
  })

  it('古い保存値に view が無ければ既定の list に戻す', () => {
    const raw = JSON.stringify({ columns: ['tags'], sort: DEFAULT_WIKI_LIST_PREFS.sort })
    expect(parseWikiListPrefs(raw).view).toBe('list')
  })

  it('未知の view は list に戻す', () => {
    const raw = JSON.stringify({ columns: ['tags'], sort: DEFAULT_WIKI_LIST_PREFS.sort, view: 'bogus' })
    expect(parseWikiListPrefs(raw).view).toBe('list')
  })

  it('folder / milestone の view はそのまま復元される', () => {
    const rawFolder = JSON.stringify({ columns: ['tags'], sort: DEFAULT_WIKI_LIST_PREFS.sort, view: 'folder' })
    expect(parseWikiListPrefs(rawFolder).view).toBe('folder')
    const rawMilestone = JSON.stringify({ columns: ['tags'], sort: DEFAULT_WIKI_LIST_PREFS.sort, view: 'milestone' })
    expect(parseWikiListPrefs(rawMilestone).view).toBe('milestone')
  })

  it('collapsedIds の既定値は空配列', () => {
    expect(DEFAULT_WIKI_LIST_PREFS.collapsedIds).toEqual([])
  })

  it('collapsedIds が配列でなければ既定の空配列に戻す', () => {
    const raw = JSON.stringify({ columns: ['tags'], sort: DEFAULT_WIKI_LIST_PREFS.sort, collapsedIds: 'x' })
    expect(parseWikiListPrefs(raw).collapsedIds).toEqual([])
  })

  it('collapsedIds はそのまま復元される', () => {
    const raw = JSON.stringify({ columns: ['tags'], sort: DEFAULT_WIKI_LIST_PREFS.sort, collapsedIds: ['p1', 'p2'] })
    expect(parseWikiListPrefs(raw).collapsedIds).toEqual(['p1', 'p2'])
  })

  it('collapsedIds の要素が文字列でないものは除去する', () => {
    const raw = JSON.stringify({ columns: ['tags'], sort: DEFAULT_WIKI_LIST_PREFS.sort, collapsedIds: ['p1', 42, null] })
    expect(parseWikiListPrefs(raw).collapsedIds).toEqual(['p1'])
  })
})

describe('既定値の v2 追補（PR4: マイルストーンをタグのように見せる）', () => {
  it('既定 columns に milestones が入る（tags の次）', () => {
    expect(DEFAULT_WIKI_LIST_PREFS.columns).toEqual(['tags', 'milestones', 'author', 'updated_at'])
  })

  it('保存キーは v2 に上がっている', () => {
    expect(WIKI_LIST_PREFS_KEY).toBe('wiki-list-prefs:v2')
  })

  it('v1 キーに保存された値は読まない（v2 の既定値になる）', () => {
    localStorage.setItem('wiki-list-prefs:v1', JSON.stringify({ columns: ['author'], sort: { key: 'title', dir: 'asc' } }))
    expect(parseWikiListPrefs(localStorage.getItem(WIKI_LIST_PREFS_KEY))).toEqual(DEFAULT_WIKI_LIST_PREFS)
  })
})

describe('useWikiListPrefs', () => {
  it('既定値から始まる', () => {
    const { result } = renderHook(() => useWikiListPrefs())
    expect(result.current[0]).toEqual(DEFAULT_WIKI_LIST_PREFS)
  })

  it('保存すると localStorage に書き込まれ、次のインスタンスにも復元される', () => {
    const { result } = renderHook(() => useWikiListPrefs())

    const next: import('@/lib/wiki/listPrefs').WikiListPrefs = {
      columns: ['author'],
      sort: { key: 'title', dir: 'asc' },
      view: 'folder',
      collapsedIds: ['p1'],
    }
    act(() => {
      result.current[1](next)
    })

    expect(result.current[0]).toEqual(next)
    expect(localStorage.getItem(WIKI_LIST_PREFS_KEY)).toBe(JSON.stringify(next))

    const { result: result2 } = renderHook(() => useWikiListPrefs())
    expect(result2.current[0]).toEqual(next)
  })
})
