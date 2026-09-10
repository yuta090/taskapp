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

  it('受け付けていれば canCheckout=true を返す', async () => {
    global.fetch = mockFetch({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
    })

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.canCheckout).toBe(true)
    expect(result.current.keysConfigured).toBe(true)
    expect(result.current.error).toBeNull()
  })

  /**
   * 受け付け（元栓）を閉じても、既に払っている方の契約管理は続けられなければならない。
   * ここを1つの真偽値にまとめると、閉じた瞬間に支払い方法の変更・解約まで塞いでしまう。
   */
  it('受け付けを閉じていても、鍵が揃っていれば keysConfigured=true のまま', async () => {
    global.fetch = mockFetch({
      canCheckout: false,
      keysConfigured: true,
      selfServeEnabled: false,
      partial: false,
    })

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.canCheckout).toBe(false)
    expect(result.current.keysConfigured).toBe(true)
    expect(result.current.selfServeEnabled).toBe(false)
  })

  it('実際に /api/stripe/status を見に行く（決め打ちしない）', async () => {
    const fetchMock = mockFetch({ canCheckout: true, keysConfigured: true, partial: false })
    global.fetch = fetchMock

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/stripe/status')
  })

  it('サーバが未設定と答えたら canCheckout=false を返す', async () => {
    global.fetch = mockFetch({
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: true,
    })

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.canCheckout).toBe(false)
    expect(result.current.keysConfigured).toBe(false)
    expect(result.current.partial).toBe(true)
  })

  it('取得に失敗したときは「使える」と言わない（決済ボタンを開けない）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 })
    expect(result.current.canCheckout).toBe(false)
    expect(result.current.keysConfigured).toBe(false)
    expect(result.current.error).not.toBeNull()
  })

  it('取得中は loading=true（未設定の案内を一瞬出さない）', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch

    const { result } = renderHook(() => useStripeStatus(), { wrapper: createWrapper() })

    expect(result.current.loading).toBe(true)
    expect(result.current.canCheckout).toBe(false)
  })
})

/**
 * 許可リスト（この組織だけ決済を通す）に対応するため、判定は組織ごとに変わる。
 * 画面が見ている組織をそのまま問い合わせに乗せること・組織ごとに別のキャッシュに
 * なることを固定する（別の組織の答えを使い回さない）。
 */
describe('useStripeStatus — 組織ごとの判定', () => {
  const originalFetch = global.fetch
  const ORG = '11111111-2222-3333-4444-555555555555'

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('組織IDを問い合わせに含める', async () => {
    const fetchMock = mockFetch({ canCheckout: true, keysConfigured: true, partial: false })
    global.fetch = fetchMock

    const { result } = renderHook(() => useStripeStatus(ORG), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(String(fetchMock.mock.calls[0][0])).toContain(`org_id=${ORG}`)
  })

  it('組織が違えば別々に問い合わせる（前の組織の答えを使い回さない）', async () => {
    const fetchMock = mockFetch({ canCheckout: true, keysConfigured: true, partial: false })
    global.fetch = fetchMock
    const wrapper = createWrapper()

    const first = renderHook(() => useStripeStatus(ORG), { wrapper })
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    const second = renderHook(() => useStripeStatus('99999999-0000-0000-0000-000000000000'), {
      wrapper,
    })
    await waitFor(() => expect(second.result.current.loading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
