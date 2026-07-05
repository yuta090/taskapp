import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPortalHistory } from '@/app/portal/history/getPortalHistory'

/**
 * Regression tests for the portal "approval history" bug (C-3):
 * audit_logs has no FK relationship to tasks (target_id is a polymorphic
 * reference), so an embedded `tasks!inner(...)` select fails with PGRST200
 * and the failure was silently swallowed into an empty-state UI.
 *
 * Fix: two-step query (audit_logs, then tasks by id) + surfaced error flag.
 */

interface AuditQueryResponse {
  data: Array<{
    id: string
    target_id: string | null
    event_type: string
    metadata: { comment?: string } | null
    occurred_at: string
  }> | null
  error: { message: string } | null
}

interface TasksQueryResponse {
  data: Array<{ id: string; title: string; type: 'task' | 'spec' }> | null
  error: { message: string } | null
}

function buildSupabaseMock(auditResponse: AuditQueryResponse, tasksResponse: TasksQueryResponse) {
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve(auditResponse)),
                  })),
                })),
              })),
            })),
          })),
        })),
      }
    }
    if (table === 'tasks') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => Promise.resolve(tasksResponse)),
        })),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from } as unknown as SupabaseClient
}

describe('getPortalHistory', () => {
  it('merges audit_logs with tasks via a two-step query (no embedded FK join)', async () => {
    const supabase = buildSupabaseMock(
      {
        data: [
          {
            id: 'log-1',
            target_id: 'task-1',
            event_type: 'approval.approved',
            metadata: { comment: 'looks good' },
            occurred_at: '2026-07-01T10:00:00+09:00',
          },
          {
            id: 'log-2',
            target_id: 'task-2',
            event_type: 'approval.changes_requested',
            metadata: { comment: 'please fix the color' },
            occurred_at: '2026-07-02T10:00:00+09:00',
          },
        ],
        error: null,
      },
      {
        data: [
          { id: 'task-1', title: 'ロゴ制作', type: 'task' },
          { id: 'task-2', title: '仕様書A', type: 'spec' },
        ],
        error: null,
      },
    )

    const result = await getPortalHistory(supabase, 'space-1', 'user-1')

    expect(result.historyError).toBe(false)
    expect(result.history).toEqual([
      {
        id: 'log-1',
        taskId: 'task-1',
        taskTitle: 'ロゴ制作',
        taskType: 'task',
        action: 'task_approved',
        comment: 'looks good',
        timestamp: '2026-07-01T10:00:00+09:00',
      },
      {
        id: 'log-2',
        taskId: 'task-2',
        taskTitle: '仕様書A',
        taskType: 'spec',
        action: 'changes_requested',
        comment: 'please fix the color',
        timestamp: '2026-07-02T10:00:00+09:00',
      },
    ])
  })

  it('returns historyError=true when the audit_logs query fails', async () => {
    const supabase = buildSupabaseMock(
      { data: null, error: { message: 'PGRST200: no relationship found' } },
      { data: null, error: null },
    )

    const result = await getPortalHistory(supabase, 'space-1', 'user-1')

    expect(result.historyError).toBe(true)
    expect(result.history).toEqual([])
  })

  it('returns historyError=true when the follow-up tasks query fails', async () => {
    const supabase = buildSupabaseMock(
      {
        data: [
          {
            id: 'log-1',
            target_id: 'task-1',
            event_type: 'approval.approved',
            metadata: null,
            occurred_at: '2026-07-01T10:00:00+09:00',
          },
        ],
        error: null,
      },
      { data: null, error: { message: 'connection error' } },
    )

    const result = await getPortalHistory(supabase, 'space-1', 'user-1')

    expect(result.historyError).toBe(true)
    expect(result.history).toEqual([])
  })

  it('returns an empty (non-error) history when there are simply no matching logs', async () => {
    const supabase = buildSupabaseMock({ data: [], error: null }, { data: [], error: null })

    const result = await getPortalHistory(supabase, 'space-1', 'user-1')

    expect(result.historyError).toBe(false)
    expect(result.history).toEqual([])
  })

  it('falls back to "Unknown Task" when a referenced task cannot be found', async () => {
    const supabase = buildSupabaseMock(
      {
        data: [
          {
            id: 'log-1',
            target_id: 'task-deleted',
            event_type: 'approval.approved',
            metadata: null,
            occurred_at: '2026-07-01T10:00:00+09:00',
          },
        ],
        error: null,
      },
      { data: [], error: null },
    )

    const result = await getPortalHistory(supabase, 'space-1', 'user-1')

    expect(result.historyError).toBe(false)
    expect(result.history[0].taskTitle).toBe('Unknown Task')
    expect(result.history[0].taskType).toBe('task')
  })
})
