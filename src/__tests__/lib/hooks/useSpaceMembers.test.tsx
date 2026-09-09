import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useSpaceMembers, useUserName } from '@/lib/hooks/useSpaceMembers'

/**
 * useSpaceMembers — プロジェクトの参加者一覧。
 *
 * 以前は30秒で、アプリ全体の既定(2分)より短く、画面を移るたびに取り直していた。
 * かといって STRUCTURE ティア(5分)には乗せない: 参加者は「他人の操作」（招待の受諾・
 * 役割変更・削除）で変わるので、5分は待たせすぎになる。既定の2分に揃え、
 * 自分の操作ぶんは patchMembers()／refetch() で即座に反映する。
 */

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn(actual.useQuery) }
})

vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: () => Promise.resolve({ user: { id: 'user-1' }, error: null }),
}))

const rpcMock = vi.fn()
const singleMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }),
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  rpcMock.mockResolvedValue({
    data: [{ user_id: 'user-1', display_name: '自分', avatar_url: null, role: 'admin' }],
    error: null,
  })
  singleMock.mockResolvedValue({ data: { display_name: '自分' }, error: null })
})

describe('useSpaceMembers — 取り直しの間隔', () => {
  it('staleTimeはアプリ既定(2分)に揃える（既定より短くして毎回取り直さない）', async () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useSpaceMembers('space-1'), { wrapper: Wrapper })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.queryKey).toEqual(['spaceMembers', 'space-1'])
    expect(options.staleTime).toBe(2 * 60_000)
  })

  it('refetch()は共有キャッシュを無効化する（役割変更・削除の直後に揃える経路）', async () => {
    const { Wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useSpaceMembers('space-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.members).toHaveLength(1))

    await act(async () => {
      await result.current.refetch()
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['spaceMembers', 'space-1'] })
  })

  it('patchMembers()は共有キャッシュを書き換え、戻り値で元に戻せる', async () => {
    // 役割変更・削除の楽観更新。画面ローカルの state ではなく共有キャッシュを動かすので、
    // 担当者や承認者の選択肢など同じ一覧を見ている場所も同時に変わる
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSpaceMembers('space-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.members).toHaveLength(1))

    let rollback: () => void = () => {}
    await act(async () => {
      rollback = result.current.patchMembers((prev) =>
        prev.map((m) => ({ ...m, role: 'viewer' }))
      )
    })
    await waitFor(() => expect(result.current.members[0].role).toBe('viewer'))

    await act(async () => rollback())
    await waitFor(() => expect(result.current.members[0].role).toBe('admin'))
  })

  it('同じプロジェクトを2か所で見てもRPCは1回だけ', async () => {
    const { Wrapper } = createWrapper()

    const { result } = renderHook(
      () => ({ a: useSpaceMembers('space-1'), b: useSpaceMembers('space-1') }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.a.members).toHaveLength(1))
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})

describe('useUserName — 表示名', () => {
  it('staleTimeはSTRUCTUREティア(5分)に揃える', async () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useUserName('user-1'), { wrapper: Wrapper })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.staleTime).toBe(5 * 60_000)
  })
})
