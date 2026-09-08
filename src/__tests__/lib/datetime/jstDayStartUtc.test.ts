import { describe, it, expect } from 'vitest'
import { jstDayStartUtc } from '@/lib/datetime/jstNow'

describe('jstDayStartUtc', () => {
  it('JSTの今日の0:00を、本物の絶対時刻で返す', () => {
    // 2026-09-09 12:00 JST = 2026-09-09 03:00 UTC → 境界は 2026-09-08 15:00 UTC
    expect(jstDayStartUtc(new Date('2026-09-09T03:00:00.000Z')).toISOString()).toBe(
      '2026-09-08T15:00:00.000Z',
    )
  })

  it('UTCでは前日でもJSTの日付で切る(1日ずれない)', () => {
    // 2026-09-09 01:00 UTC = 同日 10:00 JST
    expect(jstDayStartUtc(new Date('2026-09-09T01:00:00.000Z')).toISOString()).toBe(
      '2026-09-08T15:00:00.000Z',
    )
    // 2026-09-08 23:00 UTC = 翌 9/9 08:00 JST → 境界も9/9側へ動く
    expect(jstDayStartUtc(new Date('2026-09-08T23:00:00.000Z')).toISOString()).toBe(
      '2026-09-08T15:00:00.000Z',
    )
  })
})
