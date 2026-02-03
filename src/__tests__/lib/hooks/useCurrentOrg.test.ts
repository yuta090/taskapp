import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'

// Mock Supabase client
const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockSingle = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}))

describe('useCurrentOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup chain mocks
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ order: mockOrder })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockLimit.mockReturnValue({ single: mockSingle })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should start with loading state', () => {
    mockGetUser.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useCurrentOrg())

    expect(result.current.loading).toBe(true)
    expect(result.current.orgId).toBe(null)
    expect(result.current.error).toBe(null)
  })

  it('should return org info when user is logged in and has membership', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockSingle.mockResolvedValue({
      data: {
        org_id: 'org-456',
        role: 'owner',
        organizations: {
          id: 'org-456',
          name: 'Test Organization',
        },
      },
      error: null,
    })

    const { result } = renderHook(() => useCurrentOrg())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.orgId).toBe('org-456')
    expect(result.current.orgName).toBe('Test Organization')
    expect(result.current.role).toBe('owner')
    expect(result.current.error).toBe(null)
  })

  it('should return error when user is not logged in', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { result } = renderHook(() => useCurrentOrg())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.orgId).toBe(null)
    expect(result.current.error).toBe('ログインが必要です')
  })

  it('should return error when user has no org membership', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    })

    const { result } = renderHook(() => useCurrentOrg())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.orgId).toBe(null)
    expect(result.current.error).toBe('組織に所属していません')
  })

  it('should return error on auth error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Auth error' },
    })

    const { result } = renderHook(() => useCurrentOrg())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.orgId).toBe(null)
    expect(result.current.error).toBe('ログインが必要です')
  })

  it('should return error on database error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'OTHER_ERROR', message: 'Database error' },
    })

    const { result } = renderHook(() => useCurrentOrg())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.orgId).toBe(null)
    expect(result.current.error).toBe('組織情報の取得に失敗しました')
  })

  it('should handle different roles correctly', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockSingle.mockResolvedValue({
      data: {
        org_id: 'org-456',
        role: 'member',
        organizations: {
          id: 'org-456',
          name: 'Test Organization',
        },
      },
      error: null,
    })

    const { result } = renderHook(() => useCurrentOrg())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.role).toBe('member')
  })

  it('should call supabase with correct query', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
    mockSingle.mockResolvedValue({
      data: {
        org_id: 'org-456',
        role: 'owner',
        organizations: { id: 'org-456', name: 'Test' },
      },
      error: null,
    })

    renderHook(() => useCurrentOrg())

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('org_memberships')
    })

    expect(mockSelect).toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-123')
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(mockLimit).toHaveBeenCalledWith(1)
  })
})
