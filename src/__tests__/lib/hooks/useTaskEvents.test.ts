import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTaskEvents } from '@/lib/hooks/useTaskEvents'

// Mock Supabase client
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

interface QueryResult {
  data: unknown[] | null
  error: { message: string } | null
}

/** Terminal call is `.order(...)`, which is awaited directly. */
function resolveOrder(result: QueryResult) {
  mockOrder.mockReturnValue(Promise.resolve(result))
}

const sampleEvents = [
  { id: 'e2', task_id: 't1', actor_id: 'u1', action: 'REVIEW_BLOCK', payload: { blockedReason: '命名修正' }, created_at: '2026-07-03T10:00:00Z' },
  { id: 'e1', task_id: 't1', actor_id: 'u2', action: 'PASS_BALL', payload: { ball: 'internal' }, created_at: '2026-07-03T09:00:00Z' },
]

describe('useTaskEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Chain: from().select().eq().order()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ order: mockOrder })
    resolveOrder({ data: sampleEvents, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches task_events for the given task', async () => {
    const { result } = renderHook(() => useTaskEvents('t1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.events).toHaveLength(2)
    expect(result.current.events[0].action).toBe('REVIEW_BLOCK')
    expect(result.current.error).toBe(null)
  })

  it('queries the correct table, filter and ordering', async () => {
    renderHook(() => useTaskEvents('t1'))

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('task_events'))

    expect(mockEq).toHaveBeenCalledWith('task_id', 't1')
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('returns an empty list without querying when taskId is null', async () => {
    const { result } = renderHook(() => useTaskEvents(null))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.events).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('surfaces a database error', async () => {
    resolveOrder({ data: null, error: { message: 'boom' } })

    const { result } = renderHook(() => useTaskEvents('t1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.events).toEqual([])
  })

  it('exposes a refresh function', async () => {
    const { result } = renderHook(() => useTaskEvents('t1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(typeof result.current.refresh).toBe('function')
  })
})
