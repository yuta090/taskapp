import { describe, it, expect } from 'vitest'
import { getClientWaitingDays } from '@/lib/tasks/clientWaitingDays'

/**
 * B-4: shared by the dashboard follow-up list (staleDays) and TaskRow's
 * "N日待ち" badge, so both views agree on how long a task has been waiting
 * on the client.
 */
describe('getClientWaitingDays', () => {
  it('returns 0 for a task updated moments ago', () => {
    const now = new Date('2026-07-05T10:00:00+09:00')
    const updatedAt = '2026-07-05T09:00:00+09:00'
    expect(getClientWaitingDays(updatedAt, now)).toBe(0)
  })

  it('returns 2 just under the 3-day boundary', () => {
    const now = new Date('2026-07-05T10:00:00+09:00')
    const updatedAt = '2026-07-02T11:00:00+09:00'
    expect(getClientWaitingDays(updatedAt, now)).toBe(2)
  })

  it('returns 3 exactly at the 3-day boundary', () => {
    const now = new Date('2026-07-05T10:00:00+09:00')
    const updatedAt = '2026-07-02T10:00:00+09:00'
    expect(getClientWaitingDays(updatedAt, now)).toBe(3)
  })

  it('returns 6 just under the 7-day boundary', () => {
    const now = new Date('2026-07-08T10:00:00+09:00')
    const updatedAt = '2026-07-01T11:00:00+09:00'
    expect(getClientWaitingDays(updatedAt, now)).toBe(6)
  })

  it('returns 7 exactly at the 7-day boundary', () => {
    const now = new Date('2026-07-09T10:00:00+09:00')
    const updatedAt = '2026-07-02T10:00:00+09:00'
    expect(getClientWaitingDays(updatedAt, now)).toBe(7)
  })

  it('computes the diff on real elapsed time, not just calendar date (JST-safe)', () => {
    // Crossing midnight JST: updated 23:30 JST, now 00:30 JST next day — only
    // 1 hour has elapsed, so this must not count as "1 day" just because the
    // calendar date differs.
    const now = new Date('2026-07-03T00:30:00+09:00')
    const updatedAt = '2026-07-02T23:30:00+09:00'
    expect(getClientWaitingDays(updatedAt, now)).toBe(0)
  })
})
