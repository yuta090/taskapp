import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUnreadNotificationCount } from '@/lib/hooks/useUnreadNotificationCount'

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

describe('useUnreadNotificationCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup chain mocks
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, is: mockIs })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should start with loading state', () => {
    mockGetUser.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useUnreadNotificationCount())

    expect(result.current.loading).toBe(true)
    expect(result.current.count).toBe(0)
    expect(result.current.error).toBe(null)
  })

  it('should return 0 when user is not logged in', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { result } = renderHook(() => useUnreadNotificationCount())

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
    mockIs.mockResolvedValue({
      count: 5,
      error: null,
    })

    const { result } = renderHook(() => useUnreadNotificationCount())

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
    mockIs.mockResolvedValue({
      count: null,
      error: null,
    })

    const { result } = renderHook(() => useUnreadNotificationCount())

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
    mockIs.mockResolvedValue({
      count: null,
      error: { message: 'Database error' },
    })

    const { result } = renderHook(() => useUnreadNotificationCount())

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
    mockIs.mockResolvedValue({
      count: 3,
      error: null,
    })

    renderHook(() => useUnreadNotificationCount())

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
    mockIs.mockResolvedValue({
      count: 2,
      error: null,
    })

    const { result } = renderHook(() => useUnreadNotificationCount())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(typeof result.current.refresh).toBe('function')
  })
})
