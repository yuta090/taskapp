import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLatestClientAction } from '@/lib/hooks/useLatestClientAction'

/**
 * H-1 (internal visibility): derives "what did the client last do" from the
 * existing audit_logs data — no new column. Covers the case that motivated
 * this hook: a task bounces back from the client with 'changes_requested'
 * and the internal Inspector needs to surface that without a schema change.
 */

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq1 = vi.fn()
const mockEq2 = vi.fn()
const mockIn = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

interface QueryResult {
  data: { event_type: string }[] | null
  error: { message: string } | null
}

function resolveLimit(result: QueryResult) {
  mockLimit.mockReturnValue(Promise.resolve(result))
}

describe('useLatestClientAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Chain: from().select().eq().eq().in().order().limit()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq1 })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockEq2.mockReturnValue({ in: mockIn })
    mockIn.mockReturnValue({ order: mockOrder })
    mockOrder.mockReturnValue({ limit: mockLimit })
    resolveLimit({ data: [], error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns "changes_requested" when the latest audit event is approval.changes_requested', async () => {
    resolveLimit({ data: [{ event_type: 'approval.changes_requested' }], error: null })

    const { result } = renderHook(() => useLatestClientAction('task-1'))

    await waitFor(() => expect(result.current).toBe('changes_requested'))
  })

  it('returns "approved" when the latest audit event is approval.approved', async () => {
    resolveLimit({ data: [{ event_type: 'approval.approved' }], error: null })

    const { result } = renderHook(() => useLatestClientAction('task-1'))

    await waitFor(() => expect(result.current).toBe('approved'))
  })

  it('returns null when there is no client action history', async () => {
    resolveLimit({ data: [], error: null })

    const { result } = renderHook(() => useLatestClientAction('task-1'))

    await waitFor(() => expect(mockFrom).toHaveBeenCalled())

    expect(result.current).toBeNull()
  })

  it('returns null on a query error', async () => {
    resolveLimit({ data: null, error: { message: 'boom' } })

    const { result } = renderHook(() => useLatestClientAction('task-1'))

    await waitFor(() => expect(mockFrom).toHaveBeenCalled())

    expect(result.current).toBeNull()
  })

  it('does not query when taskId is null', async () => {
    const { result } = renderHook(() => useLatestClientAction(null))

    expect(result.current).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('queries audit_logs scoped to the task and the two approval event types', async () => {
    renderHook(() => useLatestClientAction('task-1'))

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('audit_logs'))

    expect(mockEq1).toHaveBeenCalledWith('target_id', 'task-1')
    expect(mockEq2).toHaveBeenCalledWith('target_type', 'task')
    expect(mockIn).toHaveBeenCalledWith('event_type', ['approval.approved', 'approval.changes_requested'])
    expect(mockOrder).toHaveBeenCalledWith('occurred_at', { ascending: false })
    expect(mockLimit).toHaveBeenCalledWith(1)
  })
})
