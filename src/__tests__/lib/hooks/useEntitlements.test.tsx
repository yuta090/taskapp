import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEntitlements } from '@/lib/hooks/useEntitlements'

/** 各テストで独立したキャッシュを使う（テスト間でデータが漏れないように）。 */
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

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
    const { result } = renderHook(() => useEntitlements('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.has('timed_line_reminders')).toBe(true)
    expect(result.current.has('line_pickup_dual_mode')).toBe(false)
    expect(result.current.planName).toBe('Pro')
  })

  it('取得失敗時は fail-closed（has は常に false）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    const { result } = renderHook(() => useEntitlements('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.has('timed_line_reminders')).toBe(false)
  })

  it('例外時も fail-closed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { result } = renderHook(() => useEntitlements('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.has('timed_line_reminders')).toBe(false)
  })

  it('orgId 未指定でも問い合わせる（サーバが cookie から組織を解決する既存挙動を維持）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plan_name: 'Free', features: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useEntitlements(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/limits', expect.anything())
  })
})
