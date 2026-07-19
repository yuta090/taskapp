import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'

/**
 * useUserSpaces — ユーザーが所属する全spaceを取得するフック。
 * staleTime上書き撤廃(アプリ既定=QueryProviderの2分を継承)の回帰と、
 * 既存のrefetch()が['userSpaces']を無効化する挙動(useSpaceGroups/useSpaceArchive等の
 * mutation側が依拠する経路)を確認する。
 */

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn(actual.useQuery) }
})

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1' }, loading: false, error: null }),
}))

const mockSelect = vi.fn()
const mockEqUser = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: vi.fn(() => ({ select: mockSelect })) }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

/** thenable(=await可能)なビルダ。 */
function builder(rows: Record<string, unknown>[]) {
  return {
    then: (resolve: (v: { data: typeof rows; error: null }) => unknown) => resolve({ data: rows, error: null }),
  }
}

describe('useUserSpaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ eq: mockEqUser })
    mockEqUser.mockReturnValue(builder([]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('staleTimeを上書きしない（アプリ既定=QueryProviderの2分を継承する）', async () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useUserSpaces(), { wrapper: Wrapper })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.staleTime).toBeUndefined()
  })

  it('refetch()は[\'userSpaces\']クエリを無効化する（グループ/アーカイブmutationが依拠する経路の回帰）', async () => {
    const { Wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useUserSpaces(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.refetch()
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['userSpaces'] })
  })
})
