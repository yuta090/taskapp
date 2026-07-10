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
})
