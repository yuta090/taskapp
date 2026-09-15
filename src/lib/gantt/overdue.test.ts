import { describe, it, expect } from 'vitest'
import { isTaskOverdue, todayJstString } from './overdue'

describe('todayJstString', () => {
  it('returns the JST calendar date even when UTC is still on the previous day', () => {
    // 2026-09-15 07:00 JST = 2026-09-14 22:00 UTC
    expect(todayJstString(new Date('2026-09-14T22:00:00Z'))).toBe('2026-09-15')
  })

  it('stays on the same JST date just before midnight', () => {
    // 2026-09-15 23:59 JST = 2026-09-15 14:59 UTC
    expect(todayJstString(new Date('2026-09-15T14:59:00Z'))).toBe('2026-09-15')
  })
})

describe('isTaskOverdue', () => {
  const today = '2026-09-15'

  it('is overdue when the due date is before today and the task is not done', () => {
    expect(isTaskOverdue({ status: 'in_progress', due_date: '2026-09-14' }, today)).toBe(true)
    expect(isTaskOverdue({ status: 'backlog', due_date: '2026-08-01' }, today)).toBe(true)
  })

  it('is not overdue on the due date itself', () => {
    expect(isTaskOverdue({ status: 'todo', due_date: '2026-09-15' }, today)).toBe(false)
  })

  it('is not overdue when the due date is in the future', () => {
    expect(isTaskOverdue({ status: 'todo', due_date: '2026-09-16' }, today)).toBe(false)
  })

  it('is never overdue once done', () => {
    expect(isTaskOverdue({ status: 'done', due_date: '2026-09-01' }, today)).toBe(false)
  })

  it('is not overdue without a due date', () => {
    expect(isTaskOverdue({ status: 'todo', due_date: null }, today)).toBe(false)
  })

  it('compares only the date part when the due date carries a time', () => {
    expect(isTaskOverdue({ status: 'todo', due_date: '2026-09-15T00:00:00+09:00' }, today)).toBe(false)
    expect(isTaskOverdue({ status: 'todo', due_date: '2026-09-14T23:59:00+09:00' }, today)).toBe(true)
  })
})
