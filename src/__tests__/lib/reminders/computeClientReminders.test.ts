import { describe, it, expect } from 'vitest'
import {
  computeClientReminders,
  type ReminderTaskInput,
  type ReminderRecipient,
  type SentLogEntry,
} from '@/lib/reminders/computeClientReminders'

function task(overrides: Partial<ReminderTaskInput> = {}): ReminderTaskInput {
  return {
    id: 'task-1',
    title: 'デザイン確認',
    spaceId: 'space-1',
    spaceName: 'ECサイトリニューアル',
    dueDate: null,
    ballSince: '2026-07-01T00:00:00Z',
    clientOwnerIds: ['client-1'],
    ...overrides,
  }
}

function recipient(overrides: Partial<ReminderRecipient> = {}): ReminderRecipient {
  return {
    userId: 'client-1',
    email: 'client@example.com',
    displayName: 'クライアント太郎',
    remindersEnabled: true,
    ...overrides,
  }
}

// JST 2026-07-05 09:30 = UTC 2026-07-05 00:30 → slot 0
const NOW_SLOT0 = new Date('2026-07-05T00:30:00Z')
// JST 2026-07-05 13:30 = UTC 2026-07-05 04:30 → slot 1
const NOW_SLOT1 = new Date('2026-07-05T04:30:00Z')
// JST 2026-07-05 17:30 = UTC 2026-07-05 08:30 → slot 2
const NOW_SLOT2 = new Date('2026-07-05T08:30:00Z')

describe('computeClientReminders', () => {
  it('classifies an overdue task and includes it in all three slots', () => {
    const input = {
      tasks: [task({ dueDate: '2026-07-01' })],
      recipients: [recipient()],
      sentLogs: [] as SentLogEntry[],
    }

    for (const now of [NOW_SLOT0, NOW_SLOT1, NOW_SLOT2]) {
      const result = computeClientReminders({ ...input, now })
      expect(result.digests).toHaveLength(1)
      expect(result.digests[0].overdue).toHaveLength(1)
      expect(result.digests[0].dueToday).toHaveLength(0)
      expect(result.digests[0].stalled).toHaveLength(0)
    }
  })

  it('excludes a task already logged as sent for the same slot, but includes it again in the next slot', () => {
    const sentLogs: SentLogEntry[] = [
      { taskId: 'task-1', recipientUserId: 'client-1', kind: 'overdue', sentOn: '2026-07-05', slot: 0 },
    ]

    const slot0 = computeClientReminders({
      tasks: [task({ dueDate: '2026-07-01' })],
      recipients: [recipient()],
      sentLogs,
      now: NOW_SLOT0,
    })
    expect(slot0.digests).toHaveLength(0)

    const slot1 = computeClientReminders({
      tasks: [task({ dueDate: '2026-07-01' })],
      recipients: [recipient()],
      sentLogs,
      now: NOW_SLOT1,
    })
    expect(slot1.digests).toHaveLength(1)
    expect(slot1.digests[0].overdue).toHaveLength(1)
  })

  it('sends due_today only in slot 0', () => {
    const input = {
      tasks: [task({ dueDate: '2026-07-05' })],
      recipients: [recipient()],
      sentLogs: [] as SentLogEntry[],
    }

    const slot0 = computeClientReminders({ ...input, now: NOW_SLOT0 })
    expect(slot0.digests).toHaveLength(1)
    expect(slot0.digests[0].dueToday).toHaveLength(1)
    expect(slot0.digests[0].overdue).toHaveLength(0)

    const slot1 = computeClientReminders({ ...input, now: NOW_SLOT1 })
    expect(slot1.digests).toHaveLength(0)

    const slot2 = computeClientReminders({ ...input, now: NOW_SLOT2 })
    expect(slot2.digests).toHaveLength(0)
  })

  it('sends stalled only in slot 0', () => {
    // no due date, ballSince 100 hours before NOW_SLOT0 (well past the 72h threshold)
    const ballSince = new Date(NOW_SLOT0.getTime() - 100 * 60 * 60 * 1000).toISOString()
    const input = {
      tasks: [task({ dueDate: null, ballSince })],
      recipients: [recipient()],
      sentLogs: [] as SentLogEntry[],
    }

    const slot0 = computeClientReminders({ ...input, now: NOW_SLOT0 })
    expect(slot0.digests).toHaveLength(1)
    expect(slot0.digests[0].stalled).toHaveLength(1)

    const slot1 = computeClientReminders({ ...input, now: NOW_SLOT1 })
    expect(slot1.digests).toHaveLength(0)
  })

  it('does not classify as stalled before the 72 hour boundary (71h)', () => {
    const ballSince = new Date(NOW_SLOT0.getTime() - 71 * 60 * 60 * 1000).toISOString()
    const result = computeClientReminders({
      tasks: [task({ dueDate: null, ballSince })],
      recipients: [recipient()],
      sentLogs: [],
      now: NOW_SLOT0,
    })
    expect(result.digests).toHaveLength(0)
  })

  it('classifies as stalled right after the 72 hour boundary (73h)', () => {
    const ballSince = new Date(NOW_SLOT0.getTime() - 73 * 60 * 60 * 1000).toISOString()
    const result = computeClientReminders({
      tasks: [task({ dueDate: null, ballSince })],
      recipients: [recipient()],
      sentLogs: [],
      now: NOW_SLOT0,
    })
    expect(result.digests).toHaveLength(1)
    expect(result.digests[0].stalled).toHaveLength(1)
  })

  it('does not classify a task with a future due date and recent ballSince as anything', () => {
    const result = computeClientReminders({
      tasks: [task({ dueDate: '2026-08-01', ballSince: '2026-07-04T23:00:00Z' })],
      recipients: [recipient()],
      sentLogs: [],
      now: NOW_SLOT0,
    })
    expect(result.digests).toHaveLength(0)
  })

  it('excludes recipients with remindersEnabled=false', () => {
    const result = computeClientReminders({
      tasks: [task({ dueDate: '2026-07-01' })],
      recipients: [recipient({ remindersEnabled: false })],
      sentLogs: [],
      now: NOW_SLOT0,
    })
    expect(result.digests).toHaveLength(0)
  })

  it('handles JST timezone boundary: UTC 23:30 the day before becomes JST 8:30 (slot 0) of the next day, so a due_date of that day is overdue', () => {
    // UTC 2026-07-04T23:30:00Z = JST 2026-07-05 08:30 → slot 0, today(JST) = 2026-07-05
    const now = new Date('2026-07-04T23:30:00Z')
    const result = computeClientReminders({
      tasks: [task({ dueDate: '2026-07-04' })],
      recipients: [recipient()],
      sentLogs: [],
      now,
    })
    expect(result.todayJst).toBe('2026-07-05')
    expect(result.slot).toBe(0)
    expect(result.digests).toHaveLength(1)
    expect(result.digests[0].overdue).toHaveLength(1)
    expect(result.digests[0].overdue[0].daysOverdue).toBe(1)
  })

  it('aggregates multiple tasks for one recipient into a single digest, and separates digests per recipient', () => {
    const result = computeClientReminders({
      tasks: [
        task({ id: 'task-1', dueDate: '2026-07-01', clientOwnerIds: ['client-1'] }),
        task({ id: 'task-2', dueDate: '2026-07-05', clientOwnerIds: ['client-1'] }),
        task({ id: 'task-3', dueDate: '2026-07-01', clientOwnerIds: ['client-2'] }),
      ],
      recipients: [
        recipient({ userId: 'client-1', email: 'a@example.com' }),
        recipient({ userId: 'client-2', email: 'b@example.com' }),
      ],
      sentLogs: [],
      now: NOW_SLOT0,
    })

    expect(result.digests).toHaveLength(2)
    const digest1 = result.digests.find((d) => d.recipientUserId === 'client-1')
    const digest2 = result.digests.find((d) => d.recipientUserId === 'client-2')
    expect(digest1?.overdue).toHaveLength(1)
    expect(digest1?.dueToday).toHaveLength(1)
    expect(digest2?.overdue).toHaveLength(1)
  })

  it('produces no digests when there are no target tasks', () => {
    const result = computeClientReminders({
      tasks: [],
      recipients: [recipient()],
      sentLogs: [],
      now: NOW_SLOT0,
    })
    expect(result.digests).toHaveLength(0)
    expect(result.logEntries).toHaveLength(0)
  })

  it('produces log entries matching the digests that would be sent', () => {
    const result = computeClientReminders({
      tasks: [task({ dueDate: '2026-07-01' })],
      recipients: [recipient()],
      sentLogs: [],
      now: NOW_SLOT0,
    })
    expect(result.logEntries).toEqual([
      { taskId: 'task-1', recipientUserId: 'client-1', kind: 'overdue', sentOn: '2026-07-05', slot: 0 },
    ])
  })
})
