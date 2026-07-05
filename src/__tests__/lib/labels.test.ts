import { describe, it, expect } from 'vitest'
import { getBallStatusLabel } from '@/lib/labels'

describe('getBallStatusLabel — 用語統一 (M-1)', () => {
  it('ball=client は「クライアント確認待ち」を返す', () => {
    expect(getBallStatusLabel('client')).toBe('クライアント確認待ち')
  })
})
