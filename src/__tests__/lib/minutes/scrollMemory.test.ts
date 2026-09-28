import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  clearMinutesScroll,
  readMinutesScroll,
  saveMinutesScroll,
  scrollTopToRemember,
  takeMinutesScroll,
} from '@/lib/minutes/scrollMemory'

const M = 'meeting-1'

describe('議事録の見ていた場所を覚える', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('覚えた場所を戻せる', () => {
    saveMinutesScroll(M, 1200, 5000)
    expect(readMinutesScroll(M, 5000)).toBe(1200)
  })

  it('覚えていなければ null（先頭のまま）', () => {
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })

  it('会議ごとに別々に覚える', () => {
    saveMinutesScroll(M, 1200, 5000)
    expect(readMinutesScroll('meeting-2', 5000)).toBeNull()
  })

  it('先頭は覚えない（覚えても意味が無い）', () => {
    saveMinutesScroll(M, 0, 5000)
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })

  it('先頭へ戻したら、前に覚えた場所も消す', () => {
    saveMinutesScroll(M, 1200, 5000)
    saveMinutesScroll(M, 0, 5000)
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })

  it('消せる', () => {
    saveMinutesScroll(M, 1200, 5000)
    clearMinutesScroll(M)
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })
})

describe('戻すのは一度だけ（使い切り）', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('取り出したら消える', () => {
    saveMinutesScroll(M, 1200, 5000)
    expect(takeMinutesScroll(M, 5000)).toBe(1200)
    expect(takeMinutesScroll(M, 5000)).toBeNull()
  })

  it('本文が変わって戻さないときも消す（古い場所を残さない）', () => {
    saveMinutesScroll(M, 1200, 5000)
    expect(takeMinutesScroll(M, 8000)).toBeNull()
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })

  it('覚えていなければ null（消すものが無くても落ちない）', () => {
    expect(takeMinutesScroll(M, 5000)).toBeNull()
  })
})

describe('本文が変わったときは戻さない', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    saveMinutesScroll(M, 1200, 5000)
  })

  it('少しの変化なら戻す（打ち足した程度）', () => {
    expect(readMinutesScroll(M, 5400)).toBe(1200)
    expect(readMinutesScroll(M, 4600)).toBe(1200)
  })

  it('2割を超えて変わったら戻さない（同じ座標が別の場所を指す）', () => {
    expect(readMinutesScroll(M, 8000)).toBeNull()
    expect(readMinutesScroll(M, 2000)).toBeNull()
  })

  it('本文が空になっていたら戻さない', () => {
    expect(readMinutesScroll(M, 0)).toBeNull()
  })
})

describe('壊れた値でも落ちない', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('JSON でない値は無視する', () => {
    window.sessionStorage.setItem('minutes-scroll:' + M, 'こわれた値')
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })

  it('数値でない値は無視する', () => {
    window.sessionStorage.setItem('minutes-scroll:' + M, JSON.stringify({ top: 'x', length: 1 }))
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })

  it('項目が足りない値は無視する', () => {
    window.sessionStorage.setItem('minutes-scroll:' + M, JSON.stringify({ top: 100 }))
    expect(readMinutesScroll(M, 5000)).toBeNull()
  })
})

describe('置き場所に触れないときも画面は動く', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('読めなくても落ちない（プライベートウィンドウ等）', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => saveMinutesScroll(M, 1200, 5000)).not.toThrow()
    expect(readMinutesScroll(M, 5000)).toBeNull()
    expect(takeMinutesScroll(M, 5000)).toBeNull()
    expect(() => clearMinutesScroll(M)).not.toThrow()
  })
})

describe('画面を離れるときに、どの位置を覚えるか', () => {
  it('いまの位置が分かるなら、それを覚える', () => {
    expect(scrollTopToRemember({ current: 640, wanted: 0, restored: true })).toBe(640)
  })

  it('本文がまだ組み上がっていないなら、戻そうとしていた位置を覚える', () => {
    // 枠に高さが無いあいだは scrollTop が 0 のまま。そのまま 0 を覚えると
    // 「先頭にいた」とみなされ、覚えていた場所が消える
    expect(scrollTopToRemember({ current: 0, wanted: 900, restored: true })).toBe(900)
  })

  it('まだ一度も戻していないなら、覚えているものに触らない', () => {
    // 本文が届く前に離れた場合。ここで 0 を書くと、前に覚えた場所が消える
    expect(scrollTopToRemember({ current: 0, wanted: 0, restored: false })).toBeNull()
  })

  it('戻したあとで先頭にいるなら、0 を覚える（＝忘れる）', () => {
    expect(scrollTopToRemember({ current: 0, wanted: 0, restored: true })).toBe(0)
  })
})
