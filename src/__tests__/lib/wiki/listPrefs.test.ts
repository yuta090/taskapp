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
    })
  })

  it('列が全部未知（＝結果が空）なら既定の列に戻す', () => {
    const raw = JSON.stringify({ columns: ['bogus1', 'bogus2'], sort: DEFAULT_WIKI_LIST_PREFS.sort })
    expect(parseWikiListPrefs(raw).columns).toEqual(DEFAULT_WIKI_LIST_PREFS.columns)
  })

  it('未知の並べ替えキー/方向は既定に戻す', () => {
    const raw = JSON.stringify({ columns: ['tags'], sort: { key: 'bogus', dir: 'bogus' } })
    expect(parseWikiListPrefs(raw).sort).toEqual(DEFAULT_WIKI_LIST_PREFS.sort)
  })

  it('columns が配列でない場合は既定の列に戻す', () => {
    const raw = JSON.stringify({ columns: 'tags', sort: DEFAULT_WIKI_LIST_PREFS.sort })
    expect(parseWikiListPrefs(raw).columns).toEqual(DEFAULT_WIKI_LIST_PREFS.columns)
  })
})

describe('useWikiListPrefs', () => {
  it('既定値から始まる', () => {
    const { result } = renderHook(() => useWikiListPrefs())
    expect(result.current[0]).toEqual(DEFAULT_WIKI_LIST_PREFS)
  })

  it('保存すると localStorage に書き込まれ、次のインスタンスにも復元される', () => {
    const { result } = renderHook(() => useWikiListPrefs())

    act(() => {
      result.current[1]({ columns: ['author'], sort: { key: 'title', dir: 'asc' } })
    })

    expect(result.current[0]).toEqual({ columns: ['author'], sort: { key: 'title', dir: 'asc' } })
    expect(localStorage.getItem(WIKI_LIST_PREFS_KEY)).toBe(
      JSON.stringify({ columns: ['author'], sort: { key: 'title', dir: 'asc' } })
    )

    const { result: result2 } = renderHook(() => useWikiListPrefs())
    expect(result2.current[0]).toEqual({ columns: ['author'], sort: { key: 'title', dir: 'asc' } })
  })
})
