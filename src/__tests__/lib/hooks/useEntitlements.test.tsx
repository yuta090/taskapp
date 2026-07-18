import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useEntitlements } from '@/lib/hooks/useEntitlements'

describe('useEntitlements', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('features を読み込み has(feature) が反映される', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ plan_name: 'Pro', features: ['timed_line_reminders'] }),
      }),
    )
    const { result } = renderHook(() => useEntitlements('org-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.has('timed_line_reminders')).toBe(true)
    expect(result.current.has('line_pickup_dual_mode')).toBe(false)
    expect(result.current.planName).toBe('Pro')
  })

  it('取得失敗時は fail-closed（has は常に false）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    const { result } = renderHook(() => useEntitlements('org-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.has('timed_line_reminders')).toBe(false)
  })

  it('例外時も fail-closed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { result } = renderHook(() => useEntitlements('org-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.has('timed_line_reminders')).toBe(false)
  })
})
