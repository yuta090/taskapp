import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findSimilarTasks } from './findSimilarTasks'

// ─── Supabase mock ──────────────────────────────────────────────────────
//
// Unlike a plain "ignore every filter" stub, this one also records every
// chained method call + its arguments per table, so tests can assert on how
// the query was built (e.g. that LIKE wildcards get escaped) in addition to
// asserting on the final mapped result.

interface RecordedCall {
  method: string
  args: unknown[]
}

function chainable(response: unknown, calls: RecordedCall[]) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(response)
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args })
          return proxy
        }
      },
    }
  )
  return proxy
}

interface FixtureTask {
  id: string
  title: string
  actual_hours: number
  completed_at: string | null
  updated_at: string
}

interface FixtureEvent {
  task_id: string
  action: string
  payload: Record<string, unknown>
  created_at: string
}

function makeSupabase(opts: {
  tasks: { data: FixtureTask[] | null; error: { message: string } | null }
  events?: { data: FixtureEvent[] | null; error: { message: string } | null }
}) {
  const tasksCalls: RecordedCall[] = []
  const eventsCalls: RecordedCall[] = []
  const eventsResponse = opts.events ?? { data: [], error: null }

  const supabase = {
    from: (table: string) => {
      if (table === 'tasks') return chainable(opts.tasks, tasksCalls)
      if (table === 'task_events') return chainable(eventsResponse, eventsCalls)
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as unknown as SupabaseClient

  return { supabase, tasksCalls, eventsCalls }
}

const baseParams = { spaceId: 'space-1', orgId: 'org-1' }

describe('findSimilarTasks', () => {
  describe('title guard', () => {
    it('returns an empty result without querying supabase when title is empty', async () => {
      const { supabase, tasksCalls } = makeSupabase({ tasks: { data: [], error: null } })

      const result = await findSimilarTasks(supabase, { title: '', ...baseParams })

      expect(result).toEqual({ similarTasks: [], avgHours: null, avgClientWaitDays: null })
      expect(tasksCalls).toHaveLength(0)
    })

    it('returns an empty result when the trimmed title is shorter than 2 characters', async () => {
      const { supabase, tasksCalls } = makeSupabase({ tasks: { data: [], error: null } })

      const result = await findSimilarTasks(supabase, { title: '  a  ', ...baseParams })

      expect(result).toEqual({ similarTasks: [], avgHours: null, avgClientWaitDays: null })
      expect(tasksCalls).toHaveLength(0)
    })
  })

  describe('LIKE wildcard escaping', () => {
    it('escapes %, _ and \\ in the search term before building the ilike pattern', async () => {
      const { supabase, tasksCalls } = makeSupabase({ tasks: { data: [], error: null } })

      await findSimilarTasks(supabase, { title: '50%_off\\promo', ...baseParams })

      const ilikeCall = tasksCalls.find((c) => c.method === 'ilike')
      expect(ilikeCall?.args[1]).toBe('%50\\%\\_off\\\\promo%')
    })
  })

  describe('no matching / errored tasks query', () => {
    it('returns an empty result when the tasks query errors', async () => {
      const { supabase } = makeSupabase({
        tasks: { data: null, error: { message: 'db error' } },
      })

      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })

      expect(result).toEqual({ similarTasks: [], avgHours: null, avgClientWaitDays: null })
    })

    it('returns an empty result when there are no matching tasks', async () => {
      const { supabase } = makeSupabase({ tasks: { data: [], error: null } })

      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })

      expect(result).toEqual({ similarTasks: [], avgHours: null, avgClientWaitDays: null })
    })

    it('does not query task_events at all when there are no matching tasks', async () => {
      const { supabase, eventsCalls } = makeSupabase({ tasks: { data: [], error: null } })

      await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })

      expect(eventsCalls).toHaveLength(0)
    })
  })

  describe('mapping and averages', () => {
    it('maps tasks to similarTasks and computes avgHours (rounded to 1 decimal)', async () => {
      const { supabase } = makeSupabase({
        tasks: {
          data: [
            { id: 't1', title: 'ロゴ制作A', actual_hours: 3, completed_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' },
            { id: 't2', title: 'ロゴ制作B', actual_hours: 4, completed_at: '2026-06-02T00:00:00Z', updated_at: '2026-06-02T00:00:00Z' },
            { id: 't3', title: 'ロゴ制作C', actual_hours: 4, completed_at: '2026-06-03T00:00:00Z', updated_at: '2026-06-03T00:00:00Z' },
          ],
          error: null,
        },
        events: { data: [], error: null },
      })

      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })

      expect(result.similarTasks.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
      expect(result.avgHours).toBe(3.7) // (3+4+4)/3 = 3.666... rounded to 1 decimal
    })

    it('falls back to updated_at as completed_at when completed_at is null', async () => {
      const { supabase } = makeSupabase({
        tasks: {
          data: [
            { id: 't1', title: 'ロゴ制作', actual_hours: 2, completed_at: null, updated_at: '2026-06-05T00:00:00Z' },
          ],
          error: null,
        },
      })

      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })

      expect(result.similarTasks[0].completed_at).toBe('2026-06-05T00:00:00Z')
    })

    it('returns at most 5 similarTasks but computes avgHours from all fetched (up to 10)', async () => {
      const tasks: FixtureTask[] = Array.from({ length: 6 }, (_, i) => ({
        id: `t${i + 1}`,
        title: `ロゴ制作${i + 1}`,
        actual_hours: 10, // constant so avg is trivially checkable
        completed_at: `2026-06-0${i + 1}T00:00:00Z`,
        updated_at: `2026-06-0${i + 1}T00:00:00Z`,
      }))
      const { supabase } = makeSupabase({ tasks: { data: tasks, error: null } })

      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })

      expect(result.similarTasks).toHaveLength(5)
      expect(result.avgHours).toBe(10)
    })

    it('computes avgClientWaitDays only from tasks that have a non-null client_wait_days', async () => {
      const { supabase } = makeSupabase({
        tasks: {
          data: [
            { id: 't1', title: 'ロゴ制作A', actual_hours: 2, completed_at: '2026-06-10T00:00:00Z', updated_at: '2026-06-10T00:00:00Z' },
            { id: 't2', title: 'ロゴ制作B', actual_hours: 2, completed_at: '2026-06-10T00:00:00Z', updated_at: '2026-06-10T00:00:00Z' },
          ],
          error: null,
        },
        events: {
          data: [
            // t1: 2 full days on client side, ending before completion.
            { task_id: 't1', action: 'TASK_CREATE', payload: { ball: 'client' }, created_at: '2026-06-01T00:00:00Z' },
            { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-03T00:00:00Z' },
            // t2: no events at all recorded under this id -> null (excluded from the average)
          ],
          error: null,
        },
      })

      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })

      const t1 = result.similarTasks.find((t) => t.id === 't1')
      const t2 = result.similarTasks.find((t) => t.id === 't2')
      expect(t1?.client_wait_days).toBe(2)
      expect(t2?.client_wait_days).toBeNull()
      expect(result.avgClientWaitDays).toBe(2)
    })
  })

  describe('client wait day calculation (via similarTasks[].client_wait_days)', () => {
    function completedTaskWithEvents(events: FixtureEvent[], completedAt = '2026-06-10T00:00:00Z') {
      return makeSupabase({
        tasks: {
          data: [{ id: 't1', title: 'ロゴ制作', actual_hours: 1, completed_at: completedAt, updated_at: completedAt }],
          error: null,
        },
        events: { data: events, error: null },
      })
    }

    it('returns null when there are no events for the task', async () => {
      const { supabase } = completedTaskWithEvents([])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBeNull()
    })

    it('ignores events with an unrecognized action', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'SOME_OTHER_ACTION', payload: { ball: 'client' }, created_at: '2026-06-01T00:00:00Z' },
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBeNull()
    })

    it('does not double-count when PASS_BALL reports "client" twice in a row without an intervening internal', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-03T00:00:00Z' }, // redundant, ignored
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-05T00:00:00Z' },
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      // Clock starts from the FIRST client event (06-01), not the redundant one (06-03).
      expect(result.similarTasks[0].client_wait_days).toBe(4)
    })

    it('ignores a redundant PASS_BALL "internal" when already internal (no matching client period open)', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-02T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-03T00:00:00Z' }, // +1 day
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBe(1)
    })

    it('starts counting from TASK_CREATE when the task is created with the ball on the client', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'TASK_CREATE', payload: { ball: 'client' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-04T00:00:00Z' },
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBe(3)
    })

    it('does not start counting from TASK_CREATE when the ball starts on internal', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'TASK_CREATE', payload: { ball: 'internal' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-02T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-03T00:00:00Z' },
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBe(1)
    })

    it('accumulates multiple separate client periods', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'TASK_CREATE', payload: { ball: 'internal' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-02T00:00:00Z' }, // +1 day
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-05T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-07T00:00:00Z' }, // +2 days
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBe(3)
    })

    it('counts up to completedAt (not the current time) when still on the client side at completion', async () => {
      const { supabase } = completedTaskWithEvents(
        [{ task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-01T00:00:00Z' }],
        '2026-06-06T00:00:00Z' // completed 5 days after the ball moved to the client
      )
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBe(5)
    })

    it('supports the "new_ball" payload key as an alternative to "ball"', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'PASS_BALL', payload: { new_ball: 'client' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { new_ball: 'internal' }, created_at: '2026-06-02T00:00:00Z' },
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBe(1)
    })

    it('returns null when total client time is exactly zero', async () => {
      const { supabase } = completedTaskWithEvents([
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'client' }, created_at: '2026-06-01T00:00:00Z' },
        { task_id: 't1', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-06-01T00:00:00Z' },
      ])
      const result = await findSimilarTasks(supabase, { title: 'ロゴ制作', ...baseParams })
      expect(result.similarTasks[0].client_wait_days).toBeNull()
    })
  })
})
