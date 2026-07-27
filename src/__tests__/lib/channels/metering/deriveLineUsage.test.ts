import { describe, it, expect } from 'vitest'
import { deriveLineUsage } from '@/lib/channels/metering/deriveLineUsage'

describe('deriveLineUsage', () => {
  it('quota=50 で未使用なら ok・残り50・割合0', () => {
    const v = deriveLineUsage({ used: 0, quota: 50 })
    expect(v).toEqual({
      unlimited: false,
      used: 0,
      quota: 50,
      remaining: 50,
      ratio: 0,
      level: 'ok',
    })
  })

  it('80%未満は ok', () => {
    const v = deriveLineUsage({ used: 39, quota: 50 }) // 39/50 = 78%
    expect(v.level).toBe('ok')
    expect(v.remaining).toBe(11)
  })

  it('80%到達で soft（ceil(50*0.8)=40）', () => {
    const v = deriveLineUsage({ used: 40, quota: 50 })
    expect(v.level).toBe('soft')
    expect(v.remaining).toBe(10)
  })

  it('上限到達で hard・残り0', () => {
    const v = deriveLineUsage({ used: 50, quota: 50 })
    expect(v.level).toBe('hard')
    expect(v.remaining).toBe(0)
    expect(v.ratio).toBe(1)
  })

  it('上限超過でも残り0・割合は1で頭打ち', () => {
    const v = deriveLineUsage({ used: 73, quota: 50 })
    expect(v.level).toBe('hard')
    expect(v.remaining).toBe(0)
    expect(v.ratio).toBe(1)
  })

  it('quota=null は無制限（Pro）', () => {
    const v = deriveLineUsage({ used: 999, quota: null })
    expect(v).toEqual({
      unlimited: true,
      used: 999,
      quota: null,
      remaining: null,
      ratio: null,
      level: 'ok',
    })
  })

  it('quota<=0 は無制限扱い（割り算事故防止）', () => {
    const v = deriveLineUsage({ used: 5, quota: 0 })
    expect(v.unlimited).toBe(true)
    expect(v.remaining).toBeNull()
  })

  it('used が負や NaN は 0 に丸める', () => {
    expect(deriveLineUsage({ used: -3, quota: 50 }).used).toBe(0)
    expect(deriveLineUsage({ used: Number.NaN, quota: 50 }).used).toBe(0)
  })

  it('小数の used は切り捨て', () => {
    expect(deriveLineUsage({ used: 40.9, quota: 50 }).used).toBe(40)
  })
})
