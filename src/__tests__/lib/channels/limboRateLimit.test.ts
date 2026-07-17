import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  registerInvalidClaimAttemptAndCheckLimit,
  __resetLimboRateLimitForTests,
} from '@/lib/channels/limboRateLimit'

/**
 * limbo（共有botの未承認グループ）の紐付けコード投入レート制限（設計正本 §7-8・PR3b）。
 * グループ単位(accountId, externalGroupId)で、1時間あたり10回を超える無効投入は
 * 以降を無応答化する（content-free。永続テーブルは新設せずプロセス内メモリで数える）。
 */

beforeEach(() => {
  __resetLimboRateLimitForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('registerInvalidClaimAttemptAndCheckLimit', () => {
  it('上限内は無応答化しない(false)', () => {
    for (let i = 0; i < 10; i++) {
      expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')).toBe(false)
    }
  })

  it('上限(10回)を超えた投入からは無応答化する(true)', () => {
    for (let i = 0; i < 10; i++) {
      registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')
    }
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')).toBe(true)
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')).toBe(true)
  })

  it('別グループ(externalGroupId違い)は独立してカウントする', () => {
    for (let i = 0; i < 10; i++) {
      registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')
    }
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')).toBe(true)
    // 別グループはまだ上限に達していない
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-2')).toBe(false)
  })

  it('別account(共有botが複数ある場合)は独立してカウントする', () => {
    for (let i = 0; i < 10; i++) {
      registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')
    }
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')).toBe(true)
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-2', 'G-1')).toBe(false)
  })

  it('ウィンドウ(1時間)が経過すると再びカウントがリセットされる', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T00:00:00+09:00'))
    for (let i = 0; i < 10; i++) {
      registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')
    }
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')).toBe(true)

    // 1時間+1秒進める
    vi.setSystemTime(new Date('2026-07-16T01:00:01+09:00'))
    expect(registerInvalidClaimAttemptAndCheckLimit('acc-1', 'G-1')).toBe(false)
  })
})
