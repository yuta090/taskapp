import { describe, it, expect } from 'vitest'
import {
  DUE_REMINDER_OFFSETS_MINUTES,
  SEND_HOUR_JST,
  MATERIALIZE_GRACE_MS,
  offsetToKind,
  computeScheduledAtIso,
  isDueReminderEligible,
  buildDueReminderOccurrenceDrafts,
  buildDueReminderOccurrenceDraftsForTasks,
} from '@/lib/reminders/dueReminderPlanner'

/**
 * 期限リマインド planner（設計正本 §6/§6.1/§13）の純粋ロジック。
 */

describe('offsetToKind', () => {
  it('負のオフセット→due_soon', () => {
    expect(offsetToKind(-1440)).toBe('due_soon')
  })
  it('0→due_today', () => {
    expect(offsetToKind(0)).toBe('due_today')
  })
  it('正のオフセット→overdue_confirm', () => {
    expect(offsetToKind(1440)).toBe('overdue_confirm')
  })
})

describe('computeScheduledAtIso', () => {
  it('offset 0: due_dateのJST 9:00 = 同日UTC 0:00', () => {
    expect(computeScheduledAtIso('2026-07-25', 0)).toBe('2026-07-25T00:00:00.000Z')
  })
  it('offset -1440(1日前): 前日のJST 9:00', () => {
    expect(computeScheduledAtIso('2026-07-25', -1440)).toBe('2026-07-24T00:00:00.000Z')
  })
  it('offset +1440(1日後): 翌日のJST 9:00', () => {
    expect(computeScheduledAtIso('2026-07-25', 1440)).toBe('2026-07-26T00:00:00.000Z')
  })
  it('月またぎでも正しく繰り上がる', () => {
    expect(computeScheduledAtIso('2026-07-31', 1440)).toBe('2026-08-01T00:00:00.000Z')
  })
  it('SEND_HOUR_JSTは9固定（現行仕様値の回帰）', () => {
    expect(SEND_HOUR_JST).toBe(9)
  })
  it('1日(1440分)の倍数でないoffsetは例外', () => {
    expect(() => computeScheduledAtIso('2026-07-25', 30)).toThrow()
  })
})

describe('isDueReminderEligible（§3対象条件）', () => {
  it('due_date/status/assignee_id が揃っていれば対象', () => {
    expect(isDueReminderEligible({ dueDate: '2026-07-25', status: 'todo', assigneeId: 'u-1' })).toBe(true)
  })
  it('due_date が無ければ対象外', () => {
    expect(isDueReminderEligible({ dueDate: null, status: 'todo', assigneeId: 'u-1' })).toBe(false)
  })
  it('status=doneは対象外', () => {
    expect(isDueReminderEligible({ dueDate: '2026-07-25', status: 'done', assigneeId: 'u-1' })).toBe(false)
  })
  it('assignee_idが無ければ対象外', () => {
    expect(isDueReminderEligible({ dueDate: '2026-07-25', status: 'todo', assigneeId: null })).toBe(false)
  })
})

describe('DUE_REMINDER_OFFSETS_MINUTES（うざくない秘書 再設計: 既定は当日+超過1回のみ）', () => {
  it('既定オフセットは[0, 1440]（1日前は既定オフから撤去）', () => {
    expect([...DUE_REMINDER_OFFSETS_MINUTES]).toEqual([0, 1440])
  })
})

describe('buildDueReminderOccurrenceDrafts', () => {
  it('既定2オフセット(当日+超過)のdraftを生成する（grace内）', () => {
    const now = new Date('2026-07-20T00:00:00.000Z')
    const drafts = buildDueReminderOccurrenceDrafts({ id: 'task-1', dueDate: '2026-07-25' }, now)
    expect(drafts).toHaveLength(2)
    expect(drafts.map((d) => d.offsetMinutes)).toEqual([...DUE_REMINDER_OFFSETS_MINUTES])
    expect(drafts.every((d) => d.taskId === 'task-1')).toBe(true)
    expect(drafts.every((d) => d.dueSnapshot === '2026-07-25')).toBe(true)
    expect(drafts.map((d) => d.kind)).toEqual(['due_today', 'overdue_confirm'])
  })

  it('offsetsを明示的に渡せば1日前(due_soon)も生成できる（将来のタスク単位上書き用・後方互換）', () => {
    const now = new Date('2026-07-20T00:00:00.000Z')
    const drafts = buildDueReminderOccurrenceDrafts({ id: 'task-1', dueDate: '2026-07-25' }, now, [
      -1440, 0, 1440,
    ])
    expect(drafts.map((d) => d.kind)).toEqual(['due_soon', 'due_today', 'overdue_confirm'])
  })

  it('grace超過（scheduled_at < now-24h）のdraftは生成しない', () => {
    // due_date が既に大きく過去 → 全オフセットのscheduled_atがgrace窓より前になる
    const now = new Date('2026-08-01T00:00:00.000Z')
    const drafts = buildDueReminderOccurrenceDrafts({ id: 'task-1', dueDate: '2026-07-01' }, now)
    expect(drafts).toHaveLength(0)
  })

  it('grace境界: now-24hちょうどのscheduled_atは生成する（境界含む）', () => {
    const now = new Date('2026-07-26T00:00:00.000Z')
    // offset 0 → scheduled_at = 2026-07-25T00:00:00.000Z = now - 24h（境界値）
    const drafts = buildDueReminderOccurrenceDrafts(
      { id: 'task-1', dueDate: '2026-07-25' },
      now,
      [0],
    )
    expect(drafts).toHaveLength(1)
  })

  it('グレース境界を1ms下回るとdraftは生成されない', () => {
    const now = new Date('2026-07-26T00:00:00.001Z')
    const drafts = buildDueReminderOccurrenceDrafts(
      { id: 'task-1', dueDate: '2026-07-25' },
      now,
      [0],
    )
    expect(drafts).toHaveLength(0)
  })

  it('MATERIALIZE_GRACE_MSは24時間固定（現行仕様値の回帰）', () => {
    expect(MATERIALIZE_GRACE_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('buildDueReminderOccurrenceDraftsForTasks', () => {
  const now = new Date('2026-07-20T00:00:00.000Z')

  it('assignee無/done/due無のタスクは occurrence 0', () => {
    const drafts = buildDueReminderOccurrenceDraftsForTasks(
      [
        { id: 'no-assignee', dueDate: '2026-07-25', status: 'todo', assigneeId: null },
        { id: 'done', dueDate: '2026-07-25', status: 'done', assigneeId: 'u-1' },
        { id: 'no-due', dueDate: null, status: 'todo', assigneeId: 'u-1' },
      ],
      now,
    )
    expect(drafts).toHaveLength(0)
  })

  it('対象タスクは既定2オフセット分のoccurrenceを生成する', () => {
    const drafts = buildDueReminderOccurrenceDraftsForTasks(
      [{ id: 'ok', dueDate: '2026-07-25', status: 'todo', assigneeId: 'u-1' }],
      now,
    )
    expect(drafts).toHaveLength(2)
    expect(drafts.every((d) => d.taskId === 'ok')).toBe(true)
  })

  it('複数タスクが混在しても対象だけflattenされる', () => {
    const drafts = buildDueReminderOccurrenceDraftsForTasks(
      [
        { id: 'ok-1', dueDate: '2026-07-25', status: 'todo', assigneeId: 'u-1' },
        { id: 'skip', dueDate: null, status: 'todo', assigneeId: 'u-1' },
        { id: 'ok-2', dueDate: '2026-07-26', status: 'in_progress', assigneeId: 'u-2' },
      ],
      now,
    )
    expect(drafts).toHaveLength(4)
    expect(new Set(drafts.map((d) => d.taskId))).toEqual(new Set(['ok-1', 'ok-2']))
  })
})
