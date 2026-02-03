import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBillingLimits } from '@/lib/hooks/useBillingLimits'

describe('useBillingLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockLimitsResponse = {
    plan_name: 'Free',
    projects_limit: 5,
    projects_used: 3,
    members_limit: 5,
    members_used: 2,
    clients_limit: 5,
    clients_used: 4,
    storage_limit_bytes: 104857600, // 100MB
    storage_used_bytes: 52428800, // 50MB
  }

  it('should fetch limits on mount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLimitsResponse),
    })
    global.fetch = mockFetch

    const { result } = renderHook(() => useBillingLimits())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.limits).toEqual(mockLimitsResponse)
    expect(result.current.error).toBeNull()
  })

  it('should handle fetch error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    })
    global.fetch = mockFetch

    const { result } = renderHook(() => useBillingLimits())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Unauthorized')
    expect(result.current.limits).toBeNull()
  })

  it('should pass orgId in query string', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLimitsResponse),
    })
    global.fetch = mockFetch

    renderHook(() => useBillingLimits('org-123'))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/billing/limits?org_id=org-123',
        expect.any(Object)
      )
    })
  })

  describe('isNearLimit', () => {
    it('should return true when usage >= 80%', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockLimitsResponse,
          clients_used: 4, // 80%
        }),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.isNearLimit('clients')).toBe(true)
      expect(result.current.isNearLimit('projects')).toBe(false) // 60%
    })

    it('should return false for unlimited (null limit)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockLimitsResponse,
          projects_limit: null,
        }),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.isNearLimit('projects')).toBe(false)
    })

    it('should return true for zero limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockLimitsResponse,
          projects_limit: 0,
        }),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.isNearLimit('projects')).toBe(true)
    })
  })

  describe('isAtLimit', () => {
    it('should return true when usage >= limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockLimitsResponse,
          members_used: 5, // 100%
        }),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.isAtLimit('members')).toBe(true)
    })

    it('should return false when under limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockLimitsResponse),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.isAtLimit('projects')).toBe(false)
    })
  })

  describe('getRemainingCount', () => {
    it('should return remaining count', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockLimitsResponse),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.getRemainingCount('projects')).toBe(2)
      expect(result.current.getRemainingCount('members')).toBe(3)
      expect(result.current.getRemainingCount('clients')).toBe(1)
    })

    it('should return null for unlimited', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockLimitsResponse,
          projects_limit: null,
        }),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.getRemainingCount('projects')).toBeNull()
    })
  })

  describe('getUsagePercentage', () => {
    it('should return correct percentage', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockLimitsResponse),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.getUsagePercentage('projects')).toBe(60)
      expect(result.current.getUsagePercentage('storage')).toBe(50)
    })

    it('should cap at 100%', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockLimitsResponse,
          members_used: 10, // Over limit
        }),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.getUsagePercentage('members')).toBe(100)
    })

    it('should return 100% for zero limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockLimitsResponse,
          projects_limit: 0,
        }),
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.getUsagePercentage('projects')).toBe(100)
    })
  })

  describe('refresh', () => {
    it('should refetch limits when called', async () => {
      let callCount = 0
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...mockLimitsResponse,
            projects_used: callCount,
          }),
        })
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useBillingLimits())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.limits?.projects_used).toBe(1)

      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.limits?.projects_used).toBe(2)
    })
  })

  describe('cleanup on unmount', () => {
    it('should not cause state updates after unmount', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockLimitsResponse),
      })
      global.fetch = mockFetch

      const { unmount, result } = renderHook(() => useBillingLimits())

      // Initial loading state
      expect(result.current.loading).toBe(true)

      // Unmount before fetch completes
      unmount()

      // No error should be thrown (test passes if no unhandled promise rejection)
    })
  })
})
