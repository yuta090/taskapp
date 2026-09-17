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
import { readFileSync } from 'fs'
import { join } from 'path'
import { colorIndexOf, type CollabPeer } from '@/lib/collab/scribe'
import {
  CURSOR_COLOR_COUNT,
  CURSOR_COLOR_TOKENS,
  cursorColorAt,
  cursorFallbackAt,
} from '@/lib/collab/cursorColors'

function peer(id: string, userId: string, joinedAt: number, colorIndex?: number): CollabPeer {
  return { id, userId, joinedAt, collab: true, colorIndex: colorIndex ?? null }
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

  it('自分は輪に入る前でも数える（一覧に居ないと0番に落ちて、本物の0番とぶつかる）', () => {
    const room: CollabPeer[] = [
      peer('tab-1', 'u-a', 100, 0),
      { id: 'tab-2', userId: 'u-b', joinedAt: 200, collab: false, colorIndex: null },
    ]
    expect(colorIndexOf(room, 'u-b')).toBe(1)
  })

  it('誰かが抜けたあとに入った人は、空いた番号を取る', () => {
    // 単純に入った順で数えると、残っている人と同じ番号になってしまう
    // （2人の部屋で先に居たほうが抜けると、次に入った人は必ずぶつかる）
    const room = [peer('tab-b', 'u-b', 200, 1), peer('tab-c', 'u-c', 300)]
    expect(colorIndexOf(room, 'u-c')).toBe(0)
  })

  it('空いている番号のうち、いちばん小さいものを取る', () => {
    const room = [peer('tab-a', 'u-a', 100, 0), peer('tab-c', 'u-c', 300, 2), peer('tab-d', 'u-d', 400)]
    expect(colorIndexOf(room, 'u-d')).toBe(1)
  })

  it('同時に入った2人は、別々の空きを取る', () => {
    const room = [
      peer('tab-a', 'u-a', 100, 0),
      peer('tab-b', 'u-b', 200),
      peer('tab-c', 'u-c', 200),
    ]
    expect(colorIndexOf(room, 'u-b')).toBe(1)
    expect(colorIndexOf(room, 'u-c')).toBe(2)
  })

  it('もう名乗っていれば、その番号を使い続ける', () => {
    const room = [peer('tab-a', 'u-a', 100, 0), peer('tab-b', 'u-b', 200, 3)]
    expect(colorIndexOf(room, 'u-b')).toBe(3)
  })

  it('輪に入っていない他人は数に入れない（7人以上で色が一周しないように）', () => {
    const room: CollabPeer[] = [
      { id: 'tab-a', userId: 'u-a', joinedAt: 100, collab: false, colorIndex: null },
      peer('tab-b', 'u-b', 200),
    ]
    expect(colorIndexOf(room, 'u-b')).toBe(0)
  })

  it('タブを切り替えても番号が入れ替わらない（書記の決め方とは分ける）', () => {
    // 書記は手前に出ているタブを先に選ぶが、色をそれに合わせると、
    // 誰かが別タブを見に行っただけで全員の色がずれる
    const room: CollabPeer[] = [
      { id: 'tab-1', userId: 'u-a', joinedAt: 100, collab: true, visible: false },
      { id: 'tab-2', userId: 'u-b', joinedAt: 200, collab: true, visible: true },
    ]
    expect(colorIndexOf(room, 'u-a')).toBe(0)
    expect(colorIndexOf(room, 'u-b')).toBe(1)
  })
})

describe('色の値', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--color-cursor-1')
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
    document.documentElement.style.setProperty('--color-cursor-1', '#123456')
    expect(cursorColorAt(0)).toBe('#123456')
  })

  it('トークンが読めない形なら、控えの値に落とす', () => {
    document.documentElement.style.setProperty('--color-cursor-1', 'rebeccapurple')
    expect(cursorColorAt(0)).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('使う色は全部ちがう（同じ部屋で重ならないため）', () => {
    const all = Array.from({ length: CURSOR_COLOR_COUNT }, (_, i) => cursorColorAt(i))
    expect(new Set(all).size).toBe(CURSOR_COLOR_COUNT)
  })

  it('控えの値は、描画の途中でも読める（画面を測らない）', () => {
    document.documentElement.style.setProperty('--color-cursor-1', '#123456')
    // 控えは画面を見ないので、トークンを書き換えても変わらない
    expect(cursorFallbackAt(0)).not.toBe('#123456')
    expect(cursorFallbackAt(0)).toMatch(/^#[0-9a-fA-F]{6}$/)
    document.documentElement.style.removeProperty('--color-cursor-1')
  })

  it('控えの値が、画面のトークンと食い違っていない', () => {
    // トークンが正本。値を変えたときに控えだけ古くなるのを止める
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf-8')
    for (const { token, fallback } of CURSOR_COLOR_TOKENS) {
      const found = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
      expect(found, `${token} が globals.css に見つかりません`).not.toBeNull()
      expect(found?.[1].toLowerCase()).toBe(fallback.toLowerCase())
    }
  })
})
