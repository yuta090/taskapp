import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useChannelAccount } from '@/lib/hooks/useChannelAccount'

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn(actual.useQuery) }
})

/** useChannelAccount — bot状態カード用。トグルはoptimistic updateし失敗時はロールバックする */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const accountMeta = {
  id: 'acc-1',
  channel: 'line',
  displayName: '山田会計事務所',
  lineBotUserId: 'U-bot-1',
  status: 'active' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
}

describe('useChannelAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('staleTimeはSTRUCTUREティア(5分)を明示する（mount時サイレントSWRで背景refetchは効かせる）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ account: accountMeta, viewerRole: 'owner' }),
    })

    renderHook(() => useChannelAccount('org-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.staleTime).toBe(5 * 60_000)
  })

  it('初期取得: accountとviewerRoleを返す', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ account: accountMeta, viewerRole: 'owner' }),
    })

    const { result } = renderHook(() => useChannelAccount('org-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.account).toEqual(accountMeta)
    expect(result.current.viewerRole).toBe('owner')
  })

  it('setStatus成功: optimisticに反映され、レスポンスで確定する', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ account: accountMeta, viewerRole: 'owner' }),
    })
    const { result } = renderHook(() => useChannelAccount('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ account: { ...accountMeta, status: 'disabled' } }),
    })

    await act(async () => {
      await result.current.setStatus('acc-1', 'disabled')
    })

    await waitFor(() => expect(result.current.account?.status).toBe('disabled'))
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/channels/accounts',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('setStatus失敗: ロールバックして例外を投げる', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ account: accountMeta, viewerRole: 'owner' }),
    })
    const { result } = renderHook(() => useChannelAccount('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Owner or admin only' }),
    })

    await expect(
      act(async () => {
        await result.current.setStatus('acc-1', 'disabled')
      }),
    ).rejects.toThrow('Owner or admin only')

    expect(result.current.account?.status).toBe('active')
  })
})
