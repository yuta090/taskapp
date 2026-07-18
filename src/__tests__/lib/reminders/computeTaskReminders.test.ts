import { describe, it, expect } from 'vitest'
import {
  selectDueTaskReminders,
  buildTaskReminderText,
  type TaskReminderInput,
} from '@/lib/reminders/computeTaskReminders'

const NOW = new Date('2026-07-20T08:00:00+09:00')

function task(overrides: Partial<TaskReminderInput>): TaskReminderInput {
  return {
    id: 't1',
    title: '見積書の送付',
    spaceId: 's1',
    dueDate: null,
    remindAt: '2026-07-20T08:00:00+09:00',
    remindSentAt: null,
    status: 'todo',
    ...overrides,
  }
}

describe('selectDueTaskReminders', () => {
  it('remind_at がちょうど now なら対象', () => {
    const due = selectDueTaskReminders({ tasks: [task({})], now: NOW })
    expect(due.map((t) => t.id)).toEqual(['t1'])
  })

  it('remind_at が未来なら対象外', () => {
    const due = selectDueTaskReminders({
      tasks: [task({ remindAt: '2026-07-20T08:05:00+09:00' })],
      now: NOW,
    })
    expect(due).toHaveLength(0)
  })

  it('remind_at が過去・未送信なら対象', () => {
    const due = selectDueTaskReminders({
      tasks: [task({ remindAt: '2026-07-20T07:00:00+09:00' })],
      now: NOW,
    })
    expect(due).toHaveLength(1)
  })

  it('既に送信済み(remind_sent_at >= remind_at)なら対象外(二重送信しない)', () => {
    const due = selectDueTaskReminders({
      tasks: [task({ remindSentAt: '2026-07-20T08:00:01+09:00' })],
      now: NOW,
    })
    expect(due).toHaveLength(0)
  })

  it('送信後に remind_at を先送りしたら(remind_sent_at < remind_at)再アームされ対象', () => {
    const due = selectDueTaskReminders({
      tasks: [
        task({
          remindAt: '2026-07-20T07:59:00+09:00',
          remindSentAt: '2026-07-19T08:00:00+09:00',
        }),
      ],
      now: NOW,
    })
    expect(due).toHaveLength(1)
  })

  it('完了済みタスク(status=done)は対象外', () => {
    const due = selectDueTaskReminders({
      tasks: [task({ status: 'done' })],
      now: NOW,
    })
    expect(due).toHaveLength(0)
  })

  it('remind_at が空(null)は対象外', () => {
    const due = selectDueTaskReminders({
      tasks: [task({ remindAt: null })],
      now: NOW,
    })
    expect(due).toHaveLength(0)
  })
})

describe('buildTaskReminderText', () => {
  it('タイトルとリマインド見出しを含む', () => {
    const text = buildTaskReminderText(task({ title: '請求書の確認' }))
    expect(text).toContain('リマインド')
    expect(text).toContain('請求書の確認')
  })

  it('期限があれば期限日を含む', () => {
    const text = buildTaskReminderText(task({ dueDate: '2026-07-25' }))
    expect(text).toContain('2026-07-25')
  })

  it('期限なしでも壊れない', () => {
    const text = buildTaskReminderText(task({ dueDate: null }))
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })
})
