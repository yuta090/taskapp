import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSpaceActivity, SPACE_ACTIVITY_PAGE_SIZE, spaceActivityQueryKey } from '@/lib/hooks/useSpaceActivity'
import type { ActivityRow } from '@/lib/dashboard/activity'

/**
 * 「最近のアクティビティ」の読み込み。rpc_space_activity を30件ずつ、新しい順に読み進める。
 */

const mockRpc = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: mockRpc }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

/** occurred_at が新しい順に並んだ n 件。start 件目から */
function rows(n: number, start = 0): ActivityRow[] {
  return Array.from({ length: n }, (_, i) => {
    const minute = String(59 - ((start + i) % 60)).padStart(2, '0')
    return {
      id: 1000 - (start + i),
      occurred_at: `2026-11-26T01:${minute}:00Z`,
      actor_user_id: 'user-1',
      channel: 'app',
      kind: 'task_created',
      target_id: `t-${start + i}`,
      task_id: `t-${start + i}`,
      title: `タスク${start + i}`,
      detail: null,
    }
  })
}

beforeEach(() => {
  mockRpc.mockReset()
})

describe('useSpaceActivity', () => {
  it('1回目は30件・p_before なしで読む', async () => {
    mockRpc.mockResolvedValueOnce({ data: rows(3), error: null })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSpaceActivity('space-1', { enabled: true }), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(SPACE_ACTIVITY_PAGE_SIZE).toBe(30)
    expect(mockRpc).toHaveBeenCalledWith('rpc_space_activity', {
      p_space_id: 'space-1',
      p_limit: 30,
      p_before: null,
      p_before_id: null,
      p_before_kind: null,
    })
    expect(result.current.rows).toHaveLength(3)
  })

  it('30件に満たなければ、次は無い', async () => {
    mockRpc.mockResolvedValueOnce({ data: rows(29), error: null })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSpaceActivity('space-1', { enabled: true }), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('30件ちょうどなら次がある。続きは最後の行の時刻・id・種類を渡して読み、行は続けて並ぶ', async () => {
    const first = rows(30)
    mockRpc.mockResolvedValueOnce({ data: first, error: null })
    mockRpc.mockResolvedValueOnce({ data: rows(5, 30), error: null })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSpaceActivity('space-1', { enabled: true }), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })

    expect(mockRpc).toHaveBeenLastCalledWith('rpc_space_activity', {
      p_space_id: 'space-1',
      p_limit: 30,
      p_before: first[29].occurred_at,
      p_before_id: first[29].id,
      p_before_kind: first[29].kind,
    })
    await waitFor(() => expect(result.current.rows).toHaveLength(35))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('enabled が false なら読みに行かない', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSpaceActivity('space-1', { enabled: false }), { wrapper: Wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(mockRpc).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.rows).toEqual([])
  })

  it('権限が無いときなどのエラーは error に入る', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Not authorized', code: 'P0001' } })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSpaceActivity('space-1', { enabled: true }), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.rows).toEqual([])
    expect(result.current.loading).toBe(false)
  })
  it('画面を離れるとき、「もっと見る」で読んだ分を捨てて1ページ目だけ残す（古くなった再取得を1往復で済ませる）', async () => {
    const first = rows(30)
    mockRpc.mockResolvedValueOnce({ data: first, error: null })
    mockRpc.mockResolvedValueOnce({ data: rows(30, 30), error: null })
    const { Wrapper, queryClient } = createWrapper()
    const { result, unmount } = renderHook(() => useSpaceActivity('space-1', { enabled: true }), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.rows).toHaveLength(60))

    unmount()

    const data = queryClient.getQueryData<{ pages: unknown[][]; pageParams: unknown[] }>(spaceActivityQueryKey('space-1'))
    expect(data?.pages).toHaveLength(1)
    expect(data?.pages[0]).toEqual(first)
    expect(data?.pageParams).toEqual([null])
  })
})
