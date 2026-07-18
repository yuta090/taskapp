import { describe, it, expect } from 'vitest'
import {
  PICKUP_MODE_OPTIONS,
  resolvePickupOptionState,
} from '@/lib/channels/pickupModeOptions'

describe('PICKUP_MODE_OPTIONS', () => {
  it('4つの取り込みモードを網羅する', () => {
    const values = PICKUP_MODE_OPTIONS.map((o) => o.value)
    expect(values).toEqual(
      expect.arrayContaining(['off', 'mention_only', 'all', 'all_plus_instant']),
    )
    expect(values).toHaveLength(4)
  })

  it('all_plus_instant のみ line_pickup_dual_mode を要求する', () => {
    const gated = PICKUP_MODE_OPTIONS.filter((o) => o.requiresFeature)
    expect(gated).toHaveLength(1)
    expect(gated[0].value).toBe('all_plus_instant')
    expect(gated[0].requiresFeature).toBe('line_pickup_dual_mode')
  })
})

describe('resolvePickupOptionState', () => {
  const gated = PICKUP_MODE_OPTIONS.find((o) => o.value === 'all_plus_instant')!
  const plain = PICKUP_MODE_OPTIONS.find((o) => o.value === 'all')!

  it('要件なしオプションは常に選択可能', () => {
    const s = resolvePickupOptionState(plain, { entitled: false, current: 'off' })
    expect(s.disabled).toBe(false)
    expect(s.needsUpgrade).toBe(false)
  })

  it('未解禁 orgでは有料オプションを無効化しアップグレード印を付ける', () => {
    const s = resolvePickupOptionState(gated, { entitled: false, current: 'off' })
    expect(s.disabled).toBe(true)
    expect(s.needsUpgrade).toBe(true)
  })

  it('解禁 orgでは有料オプションも選択可能', () => {
    const s = resolvePickupOptionState(gated, { entitled: true, current: 'off' })
    expect(s.disabled).toBe(false)
    expect(s.needsUpgrade).toBe(false)
  })

  it('現在値が有料オプションなら（失効しても）選択肢自体は塞がない=解除できる', () => {
    const s = resolvePickupOptionState(gated, { entitled: false, current: 'all_plus_instant' })
    expect(s.disabled).toBe(false)
    // 既に選択中なので upgrade 印は不要
    expect(s.needsUpgrade).toBe(false)
  })
})
