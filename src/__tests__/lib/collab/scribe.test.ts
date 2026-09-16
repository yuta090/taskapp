// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  electAnswerer,
  electScribe,
  minutesContentHash,
  rankOf,
  readSavedState,
  writeSavedState,
} from '@/lib/collab/scribe'

describe('書記の決め方', () => {
  it('部屋に誰も居なければ決まらない', () => {
    expect(electScribe([])).toBeNull()
  })

  it('1人だけならその人', () => {
    expect(electScribe([{ userId: 'tanaka', joinedAt: 100, collab: true }])).toBe('tanaka')
  })

  it('いちばん古くから居る人になる', () => {
    const peers = [
      { userId: 'suzuki', joinedAt: 300, collab: true },
      { userId: 'tanaka', joinedAt: 100, collab: true },
      { userId: 'yamada', joinedAt: 200, collab: true },
    ]
    expect(electScribe(peers)).toBe('tanaka')
  })

  it('入った時刻が同じなら、全員が同じ答えになるよう名前順で決める', () => {
    const peers = [
      { userId: 'yamada', joinedAt: 100, collab: true },
      { userId: 'tanaka', joinedAt: 100, collab: true },
    ]
    expect(electScribe(peers)).toBe('tanaka')
    // 並び順を変えても同じ答えになる
    expect(electScribe([...peers].reverse())).toBe('tanaka')
  })

  it('在席の一覧だけで決まる（誰が今の書記かを覚えていなくても同じ答えになる）', () => {
    // 「いまの書記は替えない」という据え置きはしない。各自が別々に覚えている値で
    // 決めると、見え方がずれたときに2人が同時に自分を書記だと思い込む
    const peers = [
      { userId: 'tanaka', joinedAt: 300, collab: true },
      { userId: 'yamada', joinedAt: 100, collab: true },
    ]
    expect(electScribe(peers)).toBe('yamada')
  })

  it('1人で書く形へ落ちた人は、書記に選ばない', () => {
    // 落ちた人の器には他の人の更新が入らない。その人が書記だと、誰の内容も列に残らない
    const peers = [
      { userId: 'tanaka', joinedAt: 100, collab: false },
      { userId: 'yamada', joinedAt: 200, collab: true },
    ]
    expect(electScribe(peers)).toBe('yamada')
  })

  it('全員が落ちていれば決まらない', () => {
    expect(electScribe([{ userId: 'tanaka', joinedAt: 100, collab: false }])).toBeNull()
  })
})

describe('目録に返事をする人', () => {
  const room = [
    { userId: 'a', joinedAt: 100, collab: true },
    { userId: 'b', joinedAt: 200, collab: true },
    { userId: 'c', joinedAt: 300, collab: true },
  ]

  it('尋ねた人を除いた、いちばん古い人', () => {
    expect(electAnswerer(room, 'c')).toBe('a')
    // 書記自身が尋ねる側でも、ちゃんと別の人が返す
    expect(electAnswerer(room, 'a')).toBe('b')
  })

  it('ほかに誰も居なければ決まらない', () => {
    expect(electAnswerer([{ userId: 'a', joinedAt: 100, collab: true }], 'a')).toBeNull()
  })

  it('落ちた人は返事の係にしない', () => {
    expect(electAnswerer([{ userId: 'a', joinedAt: 100, collab: false }, ...room.slice(1)], 'c')).toBe('b')
  })
})

describe('部屋での順番（人数の上限に使う）', () => {
  const room = [
    { userId: 'c', joinedAt: 300, collab: true },
    { userId: 'a', joinedAt: 100, collab: true },
    { userId: 'b', joinedAt: 200, collab: true },
  ]

  it('古い人から 0 番で数える', () => {
    expect(rankOf(room, 'a')).toBe(0)
    expect(rankOf(room, 'b')).toBe(1)
    expect(rankOf(room, 'c')).toBe(2)
  })

  it('並べ方は書記の決め方と同じなので、全員が同じ答えになる', () => {
    expect(rankOf([...room].reverse(), 'b')).toBe(1)
  })

  it('居ない人は、いちばん後ろとして数える', () => {
    expect(rankOf(room, 'z')).toBe(3)
  })
})

describe('保存の基準の受け渡し', () => {
  it('まだ誰も保存していなければ空', () => {
    const meta = new Y.Doc().getMap('meta')
    expect(readSavedState(meta)).toEqual({ savedAt: null, savedHash: null })
  })

  it('書いた基準を、もう一方の器でも読める', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    writeSavedState(a.getMap('meta'), { savedAt: '2026-09-16T01:00:00Z', savedHash: 'abc' })
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

    expect(readSavedState(b.getMap('meta'))).toEqual({
      savedAt: '2026-09-16T01:00:00Z',
      savedHash: 'abc',
    })
  })

  it('本文が変わっていなければ合言葉も同じ', () => {
    expect(minutesContentHash('# 会議')).toBe(minutesContentHash('# 会議'))
    expect(minutesContentHash('# 会議')).not.toBe(minutesContentHash('# 会議\n\n- 追記'))
  })
})
