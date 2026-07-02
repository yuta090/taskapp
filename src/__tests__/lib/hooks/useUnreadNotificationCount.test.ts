import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUnreadNotificationCount } from '@/lib/hooks/useUnreadNotificationCount'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

// Mock Supabase client
const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockIs = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}))

interface QueryResult {
  count: number | null
  error: { message: string } | null
}

/**
 * Builds a thenable + chainable stand-in for Supabase's PostgrestFilterBuilder.
 * `.is(...)` is the terminal call for the "unread" query (awaited directly),
 * while the "pending" query chains an additional `.in(...)` before awaiting.
 * Both must resolve to the same underlying result so a single mock can serve both branches.
 */
function createQueryResult(result: QueryResult) {
  const builder: {
    then: (resolve: (value: QueryResult) => void) => void
    eq: () => typeof builder
    in: () => typeof builder
  } = {
    then: (resolve) => resolve(result),
    eq: () => builder,
    in: () => builder,
  }
  return builder
}

function createWrapper(orgValue: Partial<ActiveOrgContextValue> = {}) {
  const value: ActiveOrgContextValue = {
    activeOrgId: null,
    activeOrgName: null,
    activeOrgRole: null,
    orgs: [],
    switchOrg: () => {},
    loading: false,
    ...orgValue,
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ActiveOrgContext.Provider, { value }, children)
    )
  }
}

describe('useUnreadNotificationCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup chain mocks: from().select().eq().eq().is()[.in()]
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, is: mockIs })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should start with loading state', () => {
    mockGetUser.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: createWrapper(),
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.count).toBe(0)
    expect(result.current.error).toBe(null)
  })

  it('should return 0 when user is not logged in', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.count).toBe(0)
    expect(result.current.error).toBe(null)
  })

  it('should return unread count when user is logged in', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockIs.mockReturnValue(createQueryResult({ count: 5, error: null }))

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.count).toBe(5)
    expect(result.current.error).toBe(null)
  })

  it('should return 0 when count is null', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockIs.mockReturnValue(createQueryResult({ count: null, error: null }))

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.count).toBe(0)
  })

  it('should handle database error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockIs.mockReturnValue(
      createQueryResult({ count: null, error: { message: 'Database error' } })
    )

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.count).toBe(0)
    expect(result.current.error).toBe('通知件数の取得に失敗しました')
  })

  it('should call supabase with correct query', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockIs.mockReturnValue(createQueryResult({ count: 3, error: null }))

    renderHook(() => useUnreadNotificationCount(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('notifications')
    })

    expect(mockSelect).toHaveBeenCalledWith('*', { count: 'exact', head: true })
    expect(mockEq).toHaveBeenCalledWith('to_user_id', 'user-123')
    expect(mockEq).toHaveBeenCalledWith('channel', 'in_app')
    expect(mockIs).toHaveBeenCalledWith('read_at', null)
  })

  it('should provide refresh function', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockIs.mockReturnValue(createQueryResult({ count: 2, error: null }))

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(typeof result.current.refresh).toBe('function')
  })
})
