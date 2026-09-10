import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useStripeStatus } from '@/lib/hooks/useStripeStatus'

/**
 * 「プランと請求」画面が決済を出せるかどうかの判定。
 *
 * **実際に起きていた不具合**: このフックは `// TODO: Stub file` の仮実装のまま本番に出ており、
 * 環境変数の設定状況にかかわらず**常に「未設定」を返していた**。その結果、本番で
 *   - 開発者向けの設定手順（環境変数名つき）が全利用者に表示される
 *   - 「Proにアップグレード」ボタンが永久に押せない＝自分で有料化できない
 *   - 有料組織に「Stripeで管理」ボタンが出ない＝支払い方法の変更・解約ができない
 * が7か月続いた。真実源はサーバの `/api/stripe/status`。ここを必ず見に行くこと。
 */

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function mockFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
}

describe('useStripeStatus', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('サーバに設定が揃っていれば serverConfigured=true を返す', async () => {
    global.fetch = mockFetch({ configured: true, partial: false })

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.serverConfigured).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('実際に /api/stripe/status を見に行く（決め打ちしない）', async () => {
    const fetchMock = mockFetch({ configured: true, partial: false })
    global.fetch = fetchMock

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/stripe/status')
  })

  it('サーバが未設定と答えたら serverConfigured=false を返す', async () => {
    global.fetch = mockFetch({ configured: false, partial: true })

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.serverConfigured).toBe(false)
    expect(result.current.partial).toBe(true)
  })

  it('取得に失敗したときは「使える」と言わない（決済ボタンを開けない）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.serverConfigured).toBe(false)
    expect(result.current.error).not.toBeNull()
  })

  it('取得中は loading=true（未設定の案内を一瞬出さない）', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    expect(result.current.loading).toBe(true)
    expect(result.current.serverConfigured).toBe(false)
  })
})
