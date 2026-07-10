import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChannelTimeline } from '@/lib/hooks/useChannelTimeline'

/**
 * useChannelTimeline — 送信ボックスのoptimistic append/失敗時のロジック
 * (保存ボタン無し・即時反映。失敗時は該当メッセージをstatus='failed'のまま残しリトライ導線にする)
 */

const mockSelect = vi.fn()
const mockEqOrg = vi.fn()
const mockEqSpace = vi.fn()
const mockOrder = vi.fn()

const mockFrom = vi.fn(() => ({ select: mockSelect }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useChannelTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ eq: mockEqOrg })
    mockEqOrg.mockReturnValue({ eq: mockEqSpace })
    mockEqSpace.mockReturnValue({ order: mockOrder })
    mockOrder.mockResolvedValue({ data: [], error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('送信成功: optimisticに即時追加され、成功後は実IDに置き換わる', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'real-1', status: 'sent' }),
    })

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let sendResult: { ok: boolean } | undefined
    await act(async () => {
      sendResult = await result.current.sendMessage('今月の請求書をお送りください。')
    })

    expect(sendResult?.ok).toBe(true)
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0]).toMatchObject({
      id: 'real-1',
      status: 'sent',
      direction: 'outbound',
      actor: 'secretary',
      body: '今月の請求書をお送りください。',
      isOptimistic: false,
    })
  })

  it('送信失敗(409等): メッセージはfailedのまま残りエラーが読める', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'LINEアカウントが無効化されています' }),
    })

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let sendResult: { ok: boolean; error?: string } | undefined
    await act(async () => {
      sendResult = await result.current.sendMessage('確認をお願いします。')
    })

    expect(sendResult?.ok).toBe(false)
    expect(sendResult?.error).toContain('無効化')
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0]).toMatchObject({
      status: 'failed',
      error: 'LINEアカウントが無効化されています',
    })
  })

  it('ネットワークエラー: failedになりリトライできる状態を保つ', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.sendMessage('リマインドです。')
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].status).toBe('failed')
    expect(result.current.messages[0].error).toContain('ネットワーク')
  })

  it('spaceId未選択: 送信せずエラーを返す', async () => {
    const { result } = renderHook(() => useChannelTimeline('org-1', null), {
      wrapper: createWrapper(),
    })

    let sendResult: { ok: boolean } | undefined
    await act(async () => {
      sendResult = await result.current.sendMessage('テスト')
    })

    expect(sendResult?.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retryMessage: 失敗行を消してから同じ本文で送り直す(重複表示にしない)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: '一時的なエラー' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'real-2', status: 'sent' }) })

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.sendMessage('請求書の件です。')
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].status).toBe('failed')
    const failedMessage = result.current.messages[0]

    await act(async () => {
      await result.current.retryMessage(failedMessage)
    })

    // 失敗行が残ったまま新規行が積まれる(重複表示)にはならず、1件だけ残る
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0]).toMatchObject({
      id: 'real-2',
      status: 'sent',
      body: '請求書の件です。',
    })
  })

  it('isLinked=falseのときrefetchIntervalが無効化される(ポーリングを止める)', async () => {
    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const callsAfterInitialLoad = mockOrder.mock.calls.length
    vi.useFakeTimers()
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(mockOrder.mock.calls.length).toBe(callsAfterInitialLoad)
  })

  it('isLinked=true(既定)では30秒毎にポーリングされる', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', true), {
        wrapper: createWrapper(),
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.isLoading).toBe(false)

      const callsAfterInitialLoad = mockOrder.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000)
      })

      expect(mockOrder.mock.calls.length).toBeGreaterThan(callsAfterInitialLoad)
    } finally {
      vi.useRealTimers()
    }
  })
})
