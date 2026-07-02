import { describe, it, expect } from 'vitest'
import {
  eventActionLabel,
  eventDetailText,
  isClientDecision,
  isMeetingEvent,
} from '@/components/task/taskEventDisplay'
import type { TaskEvent } from '@/types/database'

function ev(partial: Partial<TaskEvent>): TaskEvent {
  return {
    id: 'e', org_id: 'o', space_id: 's', task_id: 't',
    actor_id: 'u', meeting_id: null, action: 'TASK_UPDATE',
    payload: {}, created_at: '2026-07-03T00:00:00Z',
    ...partial,
  } as TaskEvent
}

describe('eventActionLabel', () => {
  it('maps known actions to Japanese labels', () => {
    expect(eventActionLabel('PASS_BALL')).toContain('ボール')
    expect(eventActionLabel('REVIEW_OPEN')).toContain('レビュー依頼')
    expect(eventActionLabel('REVIEW_BLOCK')).toContain('差し戻し')
    expect(eventActionLabel('SPEC_DECIDE')).toContain('決定')
  })

  it('falls back to the raw action for unknown values', () => {
    expect(eventActionLabel('CUSTOM_THING')).toBe('CUSTOM_THING')
  })
})

describe('eventDetailText', () => {
  it('shows the block reason for a change request', () => {
    expect(eventDetailText(ev({ action: 'REVIEW_BLOCK', payload: { blockedReason: '命名を修正' } })))
      .toBe('命名を修正')
  })

  it('shows the pass-ball reason', () => {
    expect(eventDetailText(ev({ action: 'PASS_BALL', payload: { reason: '確認お願いします' } })))
      .toBe('確認お願いします')
  })

  it('shows the decision text for a considering decision', () => {
    expect(eventDetailText(ev({ action: 'CONSIDERING_DECIDE', payload: { decisionText: 'A案で確定' } })))
      .toBe('A案で確定')
  })

  it('returns null when there is no detail', () => {
    expect(eventDetailText(ev({ action: 'TASK_UPDATE', payload: {} }))).toBeNull()
  })
})

describe('isClientDecision', () => {
  it('is true when a decision was recorded on behalf of the client', () => {
    expect(isClientDecision(ev({ action: 'CONSIDERING_DECIDE', payload: { onBehalfOf: 'client' } }))).toBe(true)
  })
  it('is false for internal decisions', () => {
    expect(isClientDecision(ev({ action: 'CONSIDERING_DECIDE', payload: { onBehalfOf: 'internal' } }))).toBe(false)
  })
})

describe('isMeetingEvent', () => {
  it('is true when the event is tied to a meeting', () => {
    expect(isMeetingEvent(ev({ meeting_id: 'm1' }))).toBe(true)
  })
  it('is false otherwise', () => {
    expect(isMeetingEvent(ev({ meeting_id: null }))).toBe(false)
  })
})
