// @vitest-environment jsdom
/**
 * 同時編集で、誰のカーソルかを色で見分ける。
 *
 * 守りたいのは2つ。
 *  1. **部屋の中で色が重ならない**。人ごとにハッシュで選ぶと、運が悪いと同じ色になり、
 *     どちらが書いているのか分からなくなる。
 *  2. **`#RRGGBB` の形で渡す**。カーソルを描く部品はこの形しか読めず、それ以外だと
 *     文字色の判定と選択範囲の色づけが壊れる（`var(--color-…)` のままでは読めない）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { colorIndexOf, type CollabPeer } from '@/lib/collab/scribe'
import { CURSOR_COLOR_COUNT, cursorColorAt } from '@/lib/collab/cursorColors'

function peer(id: string, userId: string, joinedAt: number): CollabPeer {
  return { id, userId, joinedAt, collab: true }
}

describe('部屋の中での色の割り当て', () => {
  it('人ごとに違う番号になる', () => {
    const room = [peer('tab-1', 'u-a', 100), peer('tab-2', 'u-b', 200), peer('tab-3', 'u-c', 300)]
    expect(colorIndexOf(room, 'u-a')).toBe(0)
    expect(colorIndexOf(room, 'u-b')).toBe(1)
    expect(colorIndexOf(room, 'u-c')).toBe(2)
  })

  it('同じ人のタブは同じ番号（自分の2つのタブは同じ色）', () => {
    const room = [peer('tab-1', 'u-a', 100), peer('tab-2', 'u-a', 150), peer('tab-3', 'u-b', 200)]
    expect(colorIndexOf(room, 'u-a')).toBe(0)
    expect(colorIndexOf(room, 'u-b')).toBe(1)
  })

  it('並び順が違っても、全員が同じ答えを出す', () => {
    const room = [peer('tab-3', 'u-c', 300), peer('tab-1', 'u-a', 100), peer('tab-2', 'u-b', 200)]
    expect(colorIndexOf(room, 'u-b')).toBe(1)
    expect(colorIndexOf([...room].reverse(), 'u-b')).toBe(1)
  })

  it('入った時刻が同じなら、名前順で決める（全員が同じ答えになる）', () => {
    const room = [peer('tab-2', 'u-b', 100), peer('tab-1', 'u-a', 100)]
    expect(colorIndexOf(room, 'u-a')).toBe(0)
    expect(colorIndexOf(room, 'u-b')).toBe(1)
  })

  it('部屋に居ない人は 0 番（色が無いよりはまし）', () => {
    expect(colorIndexOf([peer('tab-1', 'u-a', 100)], 'u-z')).toBe(0)
  })

  it('輪から降りた人は数に入れない', () => {
    const room: CollabPeer[] = [
      { id: 'tab-1', userId: 'u-a', joinedAt: 100, collab: false },
      peer('tab-2', 'u-b', 200),
    ]
    expect(colorIndexOf(room, 'u-b')).toBe(0)
  })
})

describe('色の値', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--color-indigo-500')
  })

  it('カーソルを描く部品が読める形（#RRGGBB）で返す', () => {
    for (let i = 0; i < CURSOR_COLOR_COUNT; i++) {
      expect(cursorColorAt(i)).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('人数の上限より多い番号でも、必ずどれかの色になる', () => {
    expect(cursorColorAt(CURSOR_COLOR_COUNT)).toBe(cursorColorAt(0))
    expect(cursorColorAt(-1)).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('画面のトークンが読めれば、その値を使う', () => {
    document.documentElement.style.setProperty('--color-indigo-500', '#123456')
    expect(cursorColorAt(0)).toBe('#123456')
  })

  it('トークンが読めない形なら、控えの値に落とす', () => {
    document.documentElement.style.setProperty('--color-indigo-500', 'rebeccapurple')
    expect(cursorColorAt(0)).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('使う色は全部ちがう（同じ部屋で重ならないため）', () => {
    const all = Array.from({ length: CURSOR_COLOR_COUNT }, (_, i) => cursorColorAt(i))
    expect(new Set(all).size).toBe(CURSOR_COLOR_COUNT)
  })
})
