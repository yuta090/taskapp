import { describe, it, expect } from 'vitest'
import { inviteStatus } from './status'

const NOW = new Date('2026-09-09T00:00:00Z').getTime()

describe('inviteStatus', () => {
  it('承諾していれば参加済み（期限が過ぎていても）', () => {
    expect(inviteStatus({ accepted_at: '2026-09-01T00:00:00Z', expires_at: '2026-09-02T00:00:00Z' }, NOW)).toBe('accepted')
  })

  it('期限が過ぎていれば期限切れ', () => {
    expect(inviteStatus({ accepted_at: null, expires_at: '2026-09-08T23:59:00Z' }, NOW)).toBe('expired')
  })

  it('期限ちょうどは期限切れ', () => {
    expect(inviteStatus({ accepted_at: null, expires_at: '2026-09-09T00:00:00Z' }, NOW)).toBe('expired')
  })

  it('まだ期限内なら返事待ち', () => {
    expect(inviteStatus({ accepted_at: null, expires_at: '2026-09-10T00:00:00Z' }, NOW)).toBe('pending')
  })
})
