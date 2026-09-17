import { describe, it, expect } from 'vitest'
import { filterRowsCached, type RowTextCache } from '@/lib/table/tableModel'

/**
 * 編集中の絞り込み。1セル直すたびに全行の検索用文字列を作り直すと、数万行で
 * 確定のたびに数十ミリ秒止まる。行の配列そのものを鍵にして覚えておき、
 * **作り直すのは直した行だけ**にする。
 */

function rows(): string[][] {
  return [
    ['ＪＦＥスチール株式会社', '広島県', 'A候補'],
    ['アースサポート株式会社', '島根県', 'B候補'],
    ['Rogue', '広島県', 'C候補'],
  ]
}

describe('filterRowsCached', () => {
  it('検索語が空なら、同じ配列をそのまま返す', () => {
    const cache: RowTextCache = new WeakMap()
    const all = rows()
    expect(filterRowsCached(all, cache, '   ')).toBe(all)
  })

  it('検索語が空のときは、覚える作業もしない(使わない人が払わない)', () => {
    const cache: RowTextCache = new WeakMap()
    const all = rows()
    filterRowsCached(all, cache, '')
    expect(cache.has(all[0])).toBe(false)
  })

  it('どのセルかに含まれる行だけ返す(大文字小文字は区別しない)', () => {
    const cache: RowTextCache = new WeakMap()
    const all = rows()
    expect(filterRowsCached(all, cache, 'rogue')).toEqual([all[2]])
    expect(filterRowsCached(all, cache, '広島')).toHaveLength(2)
  })

  it('空白区切りの複数語は AND 条件', () => {
    const cache: RowTextCache = new WeakMap()
    const all = rows()
    expect(filterRowsCached(all, cache, '広島 A候補')).toEqual([all[0]])
  })

  it('一度見た行は覚えておき、作り直さない', () => {
    const cache: RowTextCache = new WeakMap()
    const all = rows()
    filterRowsCached(all, cache, '広島')

    // 覚えた内容を差し替えると、次からはそれが使われる(＝連結をやり直していない)
    cache.set(all[0], 'さしかえ')
    expect(filterRowsCached(all, cache, 'さしかえ')).toEqual([all[0]])
  })

  it('直した行だけ作り直す(別の配列になった行は覚え直す)', () => {
    const cache: RowTextCache = new WeakMap()
    const all = rows()
    filterRowsCached(all, cache, '広島')

    // 1行だけ新しい配列に差し替える(editModel の setCell と同じ形)
    const edited = [...all]
    edited[2] = ['Rogue', '岡山県', 'C候補']

    expect(filterRowsCached(edited, cache, '岡山')).toEqual([edited[2]])
    // 触っていない行は覚えたままで、作り直されていない
    expect(cache.get(all[0])).toBe('ＪＦＥスチール株式会社 広島県 a候補'.toLowerCase())
  })
})
