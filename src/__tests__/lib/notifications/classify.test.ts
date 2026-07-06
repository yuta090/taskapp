import { describe, it, expect } from 'vitest'
import { isActionableNotification, ACTIONABLE_TYPES_ARRAY } from '@/lib/notifications/classify'

describe('isActionableNotification', () => {
  it('treats scheduling_reminder as actionable (recipient must respond)', () => {
    expect(isActionableNotification('scheduling_reminder')).toBe(true)
    expect(ACTIONABLE_TYPES_ARRAY).toContain('scheduling_reminder')
  })

  it('treats scheduling_proposal_expired as actionable (creator should follow up)', () => {
    expect(isActionableNotification('scheduling_proposal_expired')).toBe(true)
    expect(ACTIONABLE_TYPES_ARRAY).toContain('scheduling_proposal_expired')
  })

  it('does not treat unrelated types as actionable', () => {
    expect(isActionableNotification('meeting_ended')).toBe(false)
  })

  it('does not treat review_cancelled as actionable (non-action notice, no ball to act on)', () => {
    expect(isActionableNotification('review_cancelled')).toBe(false)
    expect(ACTIONABLE_TYPES_ARRAY).not.toContain('review_cancelled')
  })
})
