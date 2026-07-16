import { describe, it, expect } from 'vitest'
import { decideAutoPush, getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'

/**
 * decideAutoPush — 送信境界の縮退判定（設計正本 AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3/§7-10）
 *
 * 真理値表（on_exceed × state）:
 *   none    : ok→send / soft→send / hard→send（既定org=退行ゲート・常にno-op）
 *   degrade : ok→send / soft→隔日(REDUCE) / hard→SUPPRESS
 *   block   : ok→send / soft→send        / hard→SUPPRESS
 *
 * auto-push（digest/approval-notify/催促）にのみ適用。webhookの対話的push・console手動送信は
 * gateしない（別経路・decideAutoPushを通さない）。
 */
describe('decideAutoPush', () => {
  describe('on_exceed=none（常にsend・全既定orgのno-opを保証）', () => {
    it.each([
      ['ok', 1],
      ['soft', 1],
      ['hard', 1],
      ['ok', 2],
      ['soft', 2],
      ['hard', 2],
    ] as const)('state=%s day=%i でも send', (state, day) => {
      expect(decideAutoPush({ state, onExceed: 'none', jstDayOfYear: day })).toEqual({ deliver: true })
    })
  })

  describe('on_exceed=degrade', () => {
    it('state=ok は send', () => {
      expect(decideAutoPush({ state: 'ok', onExceed: 'degrade', jstDayOfYear: 1 })).toEqual({
        deliver: true,
      })
    })

    it('state=soft かつ 偶数日 は send（隔日の生存日）', () => {
      expect(decideAutoPush({ state: 'soft', onExceed: 'degrade', jstDayOfYear: 2 })).toEqual({
        deliver: true,
      })
    })

    it('state=soft かつ 奇数日 は縮退で送らない（隔日の休止日）', () => {
      expect(decideAutoPush({ state: 'soft', onExceed: 'degrade', jstDayOfYear: 1 })).toEqual({
        deliver: false,
        reason: 'quota_soft_degrade_alt_day',
      })
    })

    it('state=hard は抑止（SUPPRESS）', () => {
      expect(decideAutoPush({ state: 'hard', onExceed: 'degrade', jstDayOfYear: 1 })).toEqual({
        deliver: false,
        reason: 'quota_hard_suppress',
      })
      // 偶数日でも抑止は変わらない（hardはREDUCEの対象外）
      expect(decideAutoPush({ state: 'hard', onExceed: 'degrade', jstDayOfYear: 2 })).toEqual({
        deliver: false,
        reason: 'quota_hard_suppress',
      })
    })
  })

  describe('on_exceed=block', () => {
    it('state=ok は send', () => {
      expect(decideAutoPush({ state: 'ok', onExceed: 'block', jstDayOfYear: 1 })).toEqual({
        deliver: true,
      })
    })

    it('state=soft は send（blockはhardでのみ止める）', () => {
      expect(decideAutoPush({ state: 'soft', onExceed: 'block', jstDayOfYear: 1 })).toEqual({
        deliver: true,
      })
    })

    it('state=hard は抑止（SUPPRESS）', () => {
      expect(decideAutoPush({ state: 'hard', onExceed: 'block', jstDayOfYear: 1 })).toEqual({
        deliver: false,
        reason: 'quota_block_suppress',
      })
    })
  })
})

describe('getJstDayOfYear', () => {
  it('JST基準で1月1日は1を返す（UTC変換で前日にずれない）', () => {
    // 2026-01-01 00:30 JST = 2025-12-31 15:30 UTC。生Dateのgetterだと年またぎでズレやすい典型例
    const utcInstant = new Date(Date.UTC(2025, 11, 31, 15, 30, 0))
    expect(getJstDayOfYear(utcInstant)).toBe(1)
  })

  it('うるう年2026年ではない年でも通算日を素朴に計算する（2026-07-16はJST基準で197日目）', () => {
    // 2026-07-16 12:00 JST = 2026-07-16 03:00 UTC
    const utcInstant = new Date(Date.UTC(2026, 6, 16, 3, 0, 0))
    expect(getJstDayOfYear(utcInstant)).toBe(197)
  })

  it('12月31日（平年）は365を返す', () => {
    // 2026-12-31 12:00 JST = 2026-12-31 03:00 UTC
    const utcInstant = new Date(Date.UTC(2026, 11, 31, 3, 0, 0))
    expect(getJstDayOfYear(utcInstant)).toBe(365)
  })
})
