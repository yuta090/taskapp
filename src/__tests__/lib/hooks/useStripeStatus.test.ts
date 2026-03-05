import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStripeStatus } from '@/lib/hooks/useStripeStatus'

describe('useStripeStatus', () => {
  it('should return stub values', () => {
    const { result } = renderHook(() => useStripeStatus())

    expect(result.current.serverConfigured).toBe(false)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should not expose clientConfigured (not in API)', () => {
    const { result } = renderHook(() => useStripeStatus())

    expect(result.current).not.toHaveProperty('clientConfigured')
  })

  it('should only return serverConfigured, loading, and error', () => {
    const { result } = renderHook(() => useStripeStatus())

    expect(Object.keys(result.current)).toEqual(
      expect.arrayContaining(['serverConfigured', 'loading', 'error'])
    )
  })
})
