import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeBurndown, buildStateAtDate, toJSTDateString } from './computeBurndown'

// ─── Fixture types ─────────────────────────────────────────────────────

interface FixtureTask {
  id: string
  status: string
  milestone_id: string | null
}

interface FixtureAuditLog {
  id: string
  event_type: string
  target_id: string
  data_before: Record<string, unknown> | null
  data_after: Record<string, unknown> | null
  occurred_at: string
}

interface FixtureMilestone {
  id: string
  name: string
  start_date: string | null
  due_date: string | null
  created_at: string
}

// ─── Supabase mock ──────────────────────────────────────────────────────
//
// computeBurndown() issues several `.from(table).select()...` chains per
// table (e.g. `tasks` is queried both for "currently in milestone" ids and
// again for "all tasks by id"). The chain shapes differ (single()/eq()/in()
// /or()/order()), but which rows come back does not depend on the specific
// filters for these tests — the fixtures are already scoped to exactly the
// rows the test cares about. `chainable()` therefore ignores every filter
// method and resolves to a fixed response, for both `await chain` (thenable)
// and `await chain.single()` styles.

function chainable(response: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(response)
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => Promise.resolve(response)
        }
        return () => proxy
      },
    }
  )
  return proxy
}

function makeSupabase(opts: {
  milestone?: { data: unknown; error: { message: string } | null }
  tasks?: { data: FixtureTask[] | null; error: { message: string } | null }
  auditLogs?: { data: FixtureAuditLog[] | null; error: { message: string } | null }
}): SupabaseClient {
  const milestoneResponse = opts.milestone ?? { data: null, error: null }
  const tasksResponse = opts.tasks ?? { data: [], error: null }
  const auditLogsResponse = opts.auditLogs ?? { data: [], error: null }

  return {
    from: (table: string) => {
      if (table === 'milestones') return chainable(milestoneResponse)
      if (table === 'tasks') return chainable(tasksResponse)
      if (table === 'audit_logs') return chainable(auditLogsResponse)
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as unknown as SupabaseClient
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Mirrors the (local-time, non-JST) fallback date math used by computeBurndown's +14day fallback. */
function localDatePlusDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// ─── toJSTDateString ─────────────────────────────────────────────────────

describe('toJSTDateString', () => {
  it('keeps the same calendar date when UTC time + 9h does not cross midnight', () => {
    expect(toJSTDateString('2026-07-01T03:00:00Z')).toBe('2026-07-01')
  })

  it('rolls over to the next day once UTC time is late enough (UTC 15:00 -> JST 00:00 next day)', () => {
    expect(toJSTDateString('2026-07-01T15:00:00Z')).toBe('2026-07-02')
  })

  it('normalizes an already-JST-offset timestamp to the same wall-clock date', () => {
    // '2026-07-01T10:00:00+09:00' is the same instant as '2026-07-01T01:00:00Z'.
    expect(toJSTDateString('2026-07-01T10:00:00+09:00')).toBe('2026-07-01')
    expect(toJSTDateString('2026-07-01T01:00:00Z')).toBe('2026-07-01')
  })
})

// ─── buildStateAtDate ────────────────────────────────────────────────────

describe('buildStateAtDate', () => {
  it('falls back to current task state when a task has zero audit logs', () => {
    const tasks: FixtureTask[] = [{ id: 't1', status: 'in_progress', milestone_id: 'ms-1' }]
    const state = buildStateAtDate(tasks, [], 'ms-1', '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: true, status: 'in_progress' })
  })

  it('excludes tasks whose current milestone_id does not match, in the fallback path', () => {
    const tasks: FixtureTask[] = [{ id: 't1', status: 'in_progress', milestone_id: 'other-ms' }]
    const state = buildStateAtDate(tasks, [], 'ms-1', '2026-07-01')
    expect(state.get('t1')?.inMilestone).toBe(false)
  })

  it('treats every task as in-milestone when milestoneId is null (project-wide), in the fallback path', () => {
    const tasks: FixtureTask[] = [{ id: 't1', status: 'backlog', milestone_id: 'anything' }]
    const state = buildStateAtDate(tasks, [], null, '2026-07-01')
    expect(state.get('t1')?.inMilestone).toBe(true)
  })

  it('resets tasks that have ANY audit log to a neutral state, even if all logs are on/after targetDate', () => {
    const tasks: FixtureTask[] = [{ id: 't1', status: 'done', milestone_id: 'ms-1' }]
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.status_changed',
        target_id: 't1',
        data_before: { status: 'in_progress' },
        data_after: { status: 'done' },
        occurred_at: '2026-07-05T00:00:00Z', // >= targetDate, not a preLog
      },
    ]
    const state = buildStateAtDate(tasks, logs, 'ms-1', '2026-07-01')
    // Current state (done / ms-1) is ignored because the task has logs; it
    // is reconstructed from preLogs only, and there are none here.
    expect(state.get('t1')).toEqual({ inMilestone: false, status: 'backlog' })
  })

  it('applies a task.created preLog: single-milestone mode joins membership only when milestone_id matches', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'in_progress', milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: true, status: 'in_progress' })
  })

  it('applies a task.created preLog: still records status even when milestone_id does not match', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'in_progress', milestone_id: 'other-ms' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: false, status: 'in_progress' })
  })

  it('applies a task.created preLog: project-wide mode joins membership regardless of milestone_id', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'backlog', milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, null, '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: true, status: 'backlog' })
  })

  it('defaults status to "backlog" for task.created when data_after.status is missing', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')?.status).toBe('backlog')
  })

  it('applies a task.updated preLog: MS-IN reassignment turns membership on', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.updated',
        target_id: 't1',
        data_before: { milestone_id: 'other-ms' },
        data_after: { milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
    ]
    // The task must exist in stateMap for `current` to be defined (fallback entry).
    const tasks: FixtureTask[] = [{ id: 't1', status: 'backlog', milestone_id: 'other-ms' }]
    const state = buildStateAtDate(tasks, logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')?.inMilestone).toBe(true)
  })

  it('applies task.updated preLogs in order: created (IN) then updated (OUT) ends up out of the milestone', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'in_progress', milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
      {
        id: 'e2',
        event_type: 'task.updated',
        target_id: 't1',
        data_before: { milestone_id: 'ms-1' },
        data_after: { milestone_id: 'other-ms' },
        occurred_at: '2026-06-05T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: false, status: 'in_progress' })
  })

  it('ignores task.updated milestone reassignment entirely in project-wide mode', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'in_progress', milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
      {
        id: 'e2',
        event_type: 'task.updated',
        target_id: 't1',
        data_before: { milestone_id: 'ms-1' },
        data_after: { milestone_id: 'other-ms' },
        occurred_at: '2026-06-05T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, null, '2026-07-01')
    // Still in-milestone (project-wide): the reassignment preLog is a no-op.
    expect(state.get('t1')).toEqual({ inMilestone: true, status: 'in_progress' })
  })

  it('applies a task.status_changed preLog regardless of membership', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'backlog', milestone_id: 'other-ms' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
      {
        id: 'e2',
        event_type: 'task.status_changed',
        target_id: 't1',
        data_before: { status: 'backlog' },
        data_after: { status: 'done' },
        occurred_at: '2026-06-05T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: false, status: 'done' })
  })

  it('ignores a task.status_changed preLog when data_after.status is missing', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'in_progress', milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
      {
        id: 'e2',
        event_type: 'task.status_changed',
        target_id: 't1',
        data_before: { status: 'in_progress' },
        data_after: {},
        occurred_at: '2026-06-05T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')?.status).toBe('in_progress')
  })

  it('applies a task.deleted preLog by turning membership off without touching status', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'in_progress', milestone_id: 'ms-1' },
        occurred_at: '2026-06-01T00:00:00Z',
      },
      {
        id: 'e2',
        event_type: 'task.deleted',
        target_id: 't1',
        data_before: null,
        data_after: null,
        occurred_at: '2026-06-05T00:00:00Z',
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: false, status: 'in_progress' })
  })

  it('excludes events occurring exactly on targetDate (strict "<" boundary), leaving the reset neutral state', () => {
    const logs: FixtureAuditLog[] = [
      {
        id: 'e1',
        event_type: 'task.created',
        target_id: 't1',
        data_before: null,
        data_after: { status: 'in_progress', milestone_id: 'ms-1' },
        occurred_at: '2026-07-01T02:00:00+09:00', // JST date == targetDate exactly
      },
    ]
    const state = buildStateAtDate([], logs, 'ms-1', '2026-07-01')
    expect(state.get('t1')).toEqual({ inMilestone: false, status: 'backlog' })
  })
})

// ─── computeBurndown ─────────────────────────────────────────────────────

describe('computeBurndown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Fixed "now" well after every fixture's due_date unless a test overrides it.
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('single milestone mode', () => {
    it('throws when the milestone has neither start_date nor due_date', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: null,
        due_date: null,
        created_at: '2026-06-01T00:00:00Z',
      }
      const supabase = makeSupabase({ milestone: { data: milestone, error: null } })

      await expect(computeBurndown(supabase, 'space-1', 'ms-1')).rejects.toThrow(
        '開始日と期限を設定してください'
      )
    })

    it('falls back to created_at (as JST date) for startDate when start_date is null', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: null,
        due_date: '2026-07-10',
        created_at: '2026-06-14T18:30:00Z', // JST 2026-06-15T03:30
      }
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [], error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')
      expect(result.startDate).toBe('2026-06-15')
    })

    it('falls back to today+14 days (local time) for endDate when due_date is null', async () => {
      const now = new Date(2026, 6, 10, 9, 0, 0)
      vi.setSystemTime(now)
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: null,
        created_at: '2026-06-01T00:00:00Z',
      }
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [], error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')
      expect(result.endDate).toBe(localDatePlusDays(now, 14))
    })

    it('propagates an error when the milestone lookup fails', async () => {
      const supabase = makeSupabase({
        milestone: { data: null, error: { message: 'not found' } },
      })

      await expect(computeBurndown(supabase, 'space-1', 'ms-1')).rejects.toThrow(
        'Milestone not found'
      )
    })

    it('computes a flat burndown with no events: membership + done/non-done split at start', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-03',
        created_at: '2026-06-01T00:00:00Z',
      }
      const tasks: FixtureTask[] = [
        { id: 't1', status: 'backlog', milestone_id: 'ms-1' },
        { id: 't2', status: 'in_progress', milestone_id: 'ms-1' },
        { id: 't3', status: 'done', milestone_id: 'ms-1' },
        { id: 't4', status: 'backlog', milestone_id: 'other-ms' }, // not a member
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: tasks, error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.totalTasks).toBe(3)
      expect(result.dataAvailableFrom).toBeNull()
      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 2, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 2, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-03', remaining: 2, completed: 1, added: 0, reopened: 0 },
      ])
    })

    it('decrements remaining and increments completed on a task.status_changed -> done event', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-05',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-25T00:00:00Z', // before startDate
        },
        {
          id: 'e2',
          event_type: 'task.status_changed',
          target_id: 't1',
          data_before: { status: 'in_progress' },
          data_after: { status: 'done' },
          occurred_at: '2026-07-03T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [{ id: 't1', status: 'done', milestone_id: 'ms-1' }], error: null },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.totalTasks).toBe(1)
      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-03', remaining: 0, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-04', remaining: 0, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-05', remaining: 0, completed: 1, added: 0, reopened: 0 },
      ])
    })

    it('increments remaining and reopened when a done task is reopened', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-05',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-25T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.status_changed',
          target_id: 't1',
          data_before: { status: 'in_progress' },
          data_after: { status: 'done' },
          occurred_at: '2026-07-03T05:00:00Z',
        },
        {
          id: 'e3',
          event_type: 'task.status_changed',
          target_id: 't1',
          data_before: { status: 'done' },
          data_after: { status: 'in_progress' },
          occurred_at: '2026-07-04T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [{ id: 't1', status: 'in_progress', milestone_id: 'ms-1' }], error: null },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-03', remaining: 0, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-04', remaining: 1, completed: 0, added: 0, reopened: 1 },
        { date: '2026-07-05', remaining: 1, completed: 0, added: 0, reopened: 0 },
      ])
    })

    it('increases remaining (scope change) when a matching task.created event arrives mid-range', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-05',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't0',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-20T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.created',
          target_id: 't2',
          data_before: null,
          data_after: { status: 'backlog', milestone_id: 'ms-1' },
          occurred_at: '2026-07-03T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: {
          data: [
            { id: 't0', status: 'in_progress', milestone_id: 'ms-1' },
            { id: 't2', status: 'backlog', milestone_id: 'ms-1' },
          ],
          error: null,
        },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.totalTasks).toBe(1) // scope at start only counts t0
      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-03', remaining: 2, completed: 0, added: 1, reopened: 0 },
        { date: '2026-07-04', remaining: 2, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-05', remaining: 2, completed: 0, added: 0, reopened: 0 },
      ])
    })

    it('ignores a task.created event mid-range whose milestone_id does not match', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-03',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't0',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-20T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.created',
          target_id: 't2',
          data_before: null,
          data_after: { status: 'backlog', milestone_id: 'other-ms' },
          occurred_at: '2026-07-02T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: {
          data: [
            { id: 't0', status: 'in_progress', milestone_id: 'ms-1' },
            { id: 't2', status: 'backlog', milestone_id: 'other-ms' },
          ],
          error: null,
        },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.dailySnapshots.every((s) => s.remaining === 1 && s.added === 0)).toBe(true)
    })

    it('buckets multiple events landing on the same day and applies all of them', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-02',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-01T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.status_changed',
          target_id: 't1',
          data_before: { status: 'in_progress' },
          data_after: { status: 'done' },
          occurred_at: '2026-07-02T01:00:00Z',
        },
        {
          id: 'e3',
          event_type: 'task.created',
          target_id: 't2',
          data_before: null,
          data_after: { status: 'backlog', milestone_id: 'ms-1' },
          occurred_at: '2026-07-02T04:00:00Z', // same JST day (07-02) as e2
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: {
          data: [
            { id: 't1', status: 'done', milestone_id: 'ms-1' },
            { id: 't2', status: 'backlog', milestone_id: 'ms-1' },
          ],
          error: null,
        },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 0, added: 0, reopened: 0 },
        // Both e2 (t1 completed) and e3 (t2 added) land on 07-02 and are both applied.
        { date: '2026-07-02', remaining: 1, completed: 1, added: 1, reopened: 0 },
      ])
    })

    it('decrements remaining when a task.updated event moves a member OUT of the milestone', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-04',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-01T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.updated',
          target_id: 't1',
          data_before: { milestone_id: 'ms-1' },
          data_after: { milestone_id: 'other-ms' },
          occurred_at: '2026-07-02T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [{ id: 't1', status: 'in_progress', milestone_id: 'other-ms' }], error: null },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 0, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-03', remaining: 0, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-04', remaining: 0, completed: 0, added: 0, reopened: 0 },
      ])
    })

    it('increases remaining (added) when a task.updated event moves a task IN to the milestone', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-03',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-01T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.created',
          target_id: 't2',
          data_before: null,
          data_after: { status: 'backlog', milestone_id: 'other-ms' },
          occurred_at: '2026-06-01T00:00:00Z',
        },
        {
          id: 'e3',
          event_type: 'task.updated',
          target_id: 't2',
          data_before: { milestone_id: 'other-ms' },
          data_after: { milestone_id: 'ms-1' },
          occurred_at: '2026-07-02T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: {
          data: [
            { id: 't1', status: 'in_progress', milestone_id: 'ms-1' },
            { id: 't2', status: 'backlog', milestone_id: 'ms-1' },
          ],
          error: null,
        },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.totalTasks).toBe(1)
      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 2, completed: 0, added: 1, reopened: 0 },
        { date: '2026-07-03', remaining: 2, completed: 0, added: 0, reopened: 0 },
      ])
    })

    it('decrements remaining when a member task is deleted mid-range', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-03',
        created_at: '2026-06-01T00:00:00Z',
      }
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-01T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.deleted',
          target_id: 't1',
          data_before: null,
          data_after: null,
          occurred_at: '2026-07-02T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [], error: null }, // hard-deleted: no longer in `tasks`
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 0, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-03', remaining: 0, completed: 0, added: 0, reopened: 0 },
      ])
    })

    it('clips the daily loop to "today" when due_date is in the future, but reports the true due_date as endDate', async () => {
      vi.setSystemTime(new Date(2026, 6, 10, 12, 0, 0))
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-08',
        due_date: '2026-08-01',
        created_at: '2026-06-01T00:00:00Z',
      }
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [{ id: 't1', status: 'in_progress', milestone_id: 'ms-1' }], error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.endDate).toBe('2026-08-01')
      expect(result.dailySnapshots.map((s) => s.date)).toEqual([
        '2026-07-08',
        '2026-07-09',
        '2026-07-10',
      ])
    })

    it('steps across a month boundary correctly', async () => {
      vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0)) // after due_date, so it doesn't clip the range
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-30',
        due_date: '2026-08-02',
        created_at: '2026-06-01T00:00:00Z',
      }
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [], error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')

      expect(result.dailySnapshots.map((s) => s.date)).toEqual([
        '2026-07-30',
        '2026-07-31',
        '2026-08-01',
        '2026-08-02',
      ])
    })

    it('reports dataAvailableFrom as the JST date of the earliest audit log', async () => {
      const milestone: FixtureMilestone = {
        id: 'ms-1',
        name: 'MS1',
        start_date: '2026-07-01',
        due_date: '2026-07-02',
        created_at: '2026-06-01T00:00:00Z',
      }
      // Fixture must already be pre-sorted ascending, mirroring the real
      // `.order('occurred_at', { ascending: true })` query.
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'backlog', milestone_id: 'ms-1' },
          occurred_at: '2026-06-15T15:00:00Z', // JST 2026-06-16
        },
        {
          id: 'e2',
          event_type: 'task.status_changed',
          target_id: 't1',
          data_before: { status: 'backlog' },
          data_after: { status: 'in_progress' },
          occurred_at: '2026-06-20T00:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestone, error: null },
        tasks: { data: [{ id: 't1', status: 'in_progress', milestone_id: 'ms-1' }], error: null },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', 'ms-1')
      expect(result.dataAvailableFrom).toBe('2026-06-16')
    })
  })

  describe('project-wide mode (milestoneId = null)', () => {
    it('throws when there are no milestones at all', async () => {
      const supabase = makeSupabase({ milestone: { data: [], error: null } })

      await expect(computeBurndown(supabase, 'space-1', null)).rejects.toThrow(
        'マイルストーンに開始日または期限を設定してください'
      )
    })

    it('propagates an error when listing milestones fails', async () => {
      const supabase = makeSupabase({ milestone: { data: null, error: { message: 'boom' } } })

      await expect(computeBurndown(supabase, 'space-1', null)).rejects.toThrow(
        'Failed to fetch milestones'
      )
    })

    it('uses min(start_date) / max(due_date) across all milestones and treats every task as a member', async () => {
      const milestones: FixtureMilestone[] = [
        { id: 'ms-1', name: 'A', start_date: '2026-07-05', due_date: '2026-07-08', created_at: '2026-06-01T00:00:00Z' },
        { id: 'ms-2', name: 'B', start_date: '2026-07-01', due_date: '2026-07-06', created_at: '2026-06-01T00:00:00Z' },
      ]
      const tasks: FixtureTask[] = [
        { id: 't1', status: 'in_progress', milestone_id: 'ms-1' },
        { id: 't2', status: 'done', milestone_id: 'ms-2' },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestones, error: null },
        tasks: { data: tasks, error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', null)

      expect(result.milestoneId).toBe('all')
      expect(result.milestoneName).toBe('プロジェクト全体')
      expect(result.startDate).toBe('2026-07-01')
      expect(result.endDate).toBe('2026-07-08')
      expect(result.totalTasks).toBe(2)
      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 1, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 1, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-03', remaining: 1, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-04', remaining: 1, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-05', remaining: 1, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-06', remaining: 1, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-07', remaining: 1, completed: 1, added: 0, reopened: 0 },
        { date: '2026-07-08', remaining: 1, completed: 1, added: 0, reopened: 0 },
      ])
    })

    it('falls back startDate to the earliest created_at (as JST date) when no milestone has a start_date', async () => {
      const milestones: FixtureMilestone[] = [
        { id: 'ms-1', name: 'A', start_date: null, due_date: '2026-07-15', created_at: '2026-06-10T00:00:00Z' },
        { id: 'ms-2', name: 'B', start_date: null, due_date: null, created_at: '2026-06-01T00:00:00Z' },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestones, error: null },
        tasks: { data: [], error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', null)

      expect(result.startDate).toBe(toJSTDateString('2026-06-01T00:00:00Z'))
      expect(result.endDate).toBe('2026-07-15')
    })

    it('falls back endDate to today+14 days (local) when no milestone has a due_date', async () => {
      const now = new Date(2026, 6, 10, 9, 0, 0)
      vi.setSystemTime(now)
      const milestones: FixtureMilestone[] = [
        { id: 'ms-1', name: 'A', start_date: '2026-07-01', due_date: null, created_at: '2026-06-10T00:00:00Z' },
        { id: 'ms-2', name: 'B', start_date: null, due_date: null, created_at: '2026-06-01T00:00:00Z' },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestones, error: null },
        tasks: { data: [], error: null },
        auditLogs: { data: [], error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', null)

      expect(result.startDate).toBe('2026-07-01')
      expect(result.endDate).toBe(localDatePlusDays(now, 14))
    })

    it('ignores task.updated milestone reassignment entirely (membership unaffected)', async () => {
      const milestones: FixtureMilestone[] = [
        { id: 'ms-1', name: 'A', start_date: '2026-07-01', due_date: '2026-07-03', created_at: '2026-06-01T00:00:00Z' },
      ]
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'in_progress', milestone_id: 'ms-1' },
          occurred_at: '2026-06-01T00:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.updated',
          target_id: 't1',
          data_before: { milestone_id: 'ms-1' },
          data_after: { milestone_id: 'ms-2' },
          occurred_at: '2026-07-02T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestones, error: null },
        tasks: { data: [{ id: 't1', status: 'in_progress', milestone_id: 'ms-2' }], error: null },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', null)

      expect(result.dailySnapshots.every((s) => s.remaining === 1 && s.added === 0)).toBe(true)
    })

    it('unconditionally adds newly created tasks and removes deleted tasks regardless of milestone_id', async () => {
      const milestones: FixtureMilestone[] = [
        { id: 'ms-1', name: 'A', start_date: '2026-07-01', due_date: '2026-07-04', created_at: '2026-06-01T00:00:00Z' },
      ]
      const auditLogs: FixtureAuditLog[] = [
        {
          id: 'e1',
          event_type: 'task.created',
          target_id: 't1',
          data_before: null,
          data_after: { status: 'backlog', milestone_id: 'ms-999' }, // unrelated milestone, still counted (project-wide)
          occurred_at: '2026-07-02T05:00:00Z',
        },
        {
          id: 'e2',
          event_type: 'task.deleted',
          target_id: 't1',
          data_before: null,
          data_after: null,
          occurred_at: '2026-07-03T05:00:00Z',
        },
      ]
      const supabase = makeSupabase({
        milestone: { data: milestones, error: null },
        tasks: { data: [], error: null },
        auditLogs: { data: auditLogs, error: null },
      })

      const result = await computeBurndown(supabase, 'space-1', null)

      expect(result.totalTasks).toBe(0)
      expect(result.dailySnapshots).toEqual([
        { date: '2026-07-01', remaining: 0, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-02', remaining: 1, completed: 0, added: 1, reopened: 0 },
        { date: '2026-07-03', remaining: 0, completed: 0, added: 0, reopened: 0 },
        { date: '2026-07-04', remaining: 0, completed: 0, added: 0, reopened: 0 },
      ])
    })
  })
})
