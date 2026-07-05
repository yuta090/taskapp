import { describe, it, expect } from 'vitest'
import { computeHealthStatus } from '@/lib/portal/computeHealthStatus'

/**
 * Regression tests for H-2: the portal dashboard could show "現在のステータス:
 * 順調に進行中" at the same time as "次回納品予定: 127日超過", because health
 * status ignored milestone/delivery overdue days entirely.
 */
describe('computeHealthStatus', () => {
  it('is on_track when nothing is overdue and the action queue is small', () => {
    const result = computeHealthStatus({
      overdueTaskCount: 0,
      totalActionTaskCount: 2,
      milestoneOverdueDays: 0,
    })

    expect(result.status).toBe('on_track')
  })

  it('is needs_attention when a milestone/delivery date is overdue, even with zero overdue tasks (regression guard)', () => {
    const result = computeHealthStatus({
      overdueTaskCount: 0,
      totalActionTaskCount: 2,
      milestoneOverdueDays: 127,
      milestoneName: '納品フェーズ1',
    })

    expect(result.status).toBe('needs_attention')
    expect(result.reason).toContain('127日')
    expect(result.reason).toContain('納品フェーズ1')
  })

  it('is needs_attention when individual client tasks are overdue', () => {
    const result = computeHealthStatus({
      overdueTaskCount: 3,
      totalActionTaskCount: 3,
      milestoneOverdueDays: 0,
    })

    expect(result.status).toBe('needs_attention')
    expect(result.reason).toContain('3件')
  })

  it('prioritizes needs_attention when both tasks and the milestone are overdue', () => {
    const result = computeHealthStatus({
      overdueTaskCount: 2,
      totalActionTaskCount: 8,
      milestoneOverdueDays: 30,
    })

    expect(result.status).toBe('needs_attention')
  })

  it('is at_risk when nothing is overdue but the action queue is large', () => {
    const result = computeHealthStatus({
      overdueTaskCount: 0,
      totalActionTaskCount: 6,
      milestoneOverdueDays: 0,
    })

    expect(result.status).toBe('at_risk')
  })

  it('treats a milestone due today (0 days overdue) as not overdue', () => {
    const result = computeHealthStatus({
      overdueTaskCount: 0,
      totalActionTaskCount: 1,
      milestoneOverdueDays: 0,
    })

    expect(result.status).toBe('on_track')
  })
})
