import { describe, it, expect, vi, afterEach } from 'vitest'
import { jstNow } from '@/lib/datetime/jstNow'

/**
 * jstNow(): 実行環境のタイムゾーンに依存せず、JSTの現在日時「成分」を持つ Date を返す。
 *
 * due.ts のパーサは now.getFullYear()/getMonth()/getDate()/getDay()/getHours() という
 * ローカル getter を使う。本番Vercelは既定UTCのため、生の new Date() を渡すと
 * 朝7時JST(=前日22時UTC)に日付が1日ずれる（Codexレビューで確認された実バグ）。
 * jstNow() は JST成分から Date を再構築するので、getter が JST値を返す。
 */

afterEach(() => {
  vi.useRealTimers()
})

describe('jstNow', () => {
  it('UTC 22:00 は JST では翌日07:00 として成分が返る（1日ずれない）', () => {
    // 2026-07-13T22:00:00Z = 2026-07-14 07:00 JST
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T22:00:00.000Z'))

    const n = jstNow()
    expect(n.getFullYear()).toBe(2026)
    expect(n.getMonth()).toBe(6) // 0-based = July
    expect(n.getDate()).toBe(14) // ★UTCなら13だが、JSTで14
    expect(n.getHours()).toBe(7)
  })

  it('JST正午は同日正午の成分', () => {
    // 2026-07-14T03:00:00Z = 2026-07-14 12:00 JST
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T03:00:00.000Z'))

    const n = jstNow()
    expect(n.getFullYear()).toBe(2026)
    expect(n.getDate()).toBe(14)
    expect(n.getHours()).toBe(12)
  })

  it('年末 UTC は JST で越年する', () => {
    // 2026-12-31T15:30:00Z = 2027-01-01 00:30 JST
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T15:30:00.000Z'))

    const n = jstNow()
    expect(n.getFullYear()).toBe(2027)
    expect(n.getMonth()).toBe(0) // January
    expect(n.getDate()).toBe(1)
  })

  it('曜日も JST 基準（UTCとJSTで日付が異なる時刻）', () => {
    // 2026-07-13T20:00:00Z(月) = 2026-07-14 05:00 JST(火)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T20:00:00.000Z'))

    const n = jstNow()
    expect(n.getDay()).toBe(2) // 火曜=2（UTCなら月曜=1）
  })
})
