import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStripeStatus } from '@/lib/hooks/useStripeStatus'

// Mock getStripeClientConfigStatus
vi.mock('@/lib/stripe/config', () => ({
  getStripeClientConfigStatus: vi.fn(() => ({
    isConfigured: true,
    hasPublishableKey: true,
    missingKeys: [],
  })),
}))

describe('useStripeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should start with loading state', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useStripeStatus())

    expect(result.current.loading).toBe(true)
    expect(result.current.serverConfigured).toBe(null)
    expect(result.current.error).toBe(null)
  })

  it('should return configured status when server is configured', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ configured: true }),
    })

    const { result } = renderHook(() => useStripeStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.serverConfigured).toBe(true)
    expect(result.current.error).toBe(null)
  })

  it('should return not configured when server is not configured', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ configured: false }),
    })

    const { result } = renderHook(() => useStripeStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.serverConfigured).toBe(false)
    expect(result.current.error).toBe(null)
  })

  it('should handle non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    const { result } = renderHook(() => useStripeStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.serverConfigured).toBe(false)
  })

  it('should handle fetch error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useStripeStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.serverConfigured).toBe(false)
    expect(result.current.error).toBe('Failed to check Stripe status')
  })

  it('should include client configured status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ configured: true }),
    })

    const { result } = renderHook(() => useStripeStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.clientConfigured).toBe(true)
  })
})
