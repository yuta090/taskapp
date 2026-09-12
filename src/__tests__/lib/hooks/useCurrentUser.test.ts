import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthSessionMissingError } from '@supabase/supabase-js'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'
import { __resetNavigationLeavingStateForTest } from '@/lib/net/isNavigationAbort'

const mockGetUser = vi.fn()
// getCachedUser（cached-auth.ts）はロックを避けるため getSession() でトークンを
// ローカルに読んでから getUser(token) で検証する。既定はログイン中を表す値を返す
const mockGetSession = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
    },
  }),
}))

/** Builds a QueryClientProvider wrapper. Pass a shared client to simulate cache reuse across mounts. */
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    })
    invalidateCachedUser()
    __resetNavigationLeavingStateForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not log a console error when there is no session (AuthSessionMissingError)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.user).toBe(null)
    expect(result.current.error).toBe(null)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('should still log a console error for unexpected auth errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('network down'),
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('ユーザー情報の取得に失敗しました')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  // @supabase/auth-js の実際の挙動: getUser() は AuthError を reject ではなく
  // `{ data: { user: null }, error }` として resolve する（GoTrueClient._getUser の try/catch）。
  // 以降の打ち切り判定のテストも、実物と同じくこの形で渡す
  it('should not log a console error when getUser is aborted by page navigation (AbortError)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const abortErr = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    mockGetUser.mockResolvedValue({ data: { user: null }, error: abortErr })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('ユーザー情報の取得に失敗しました')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('should not log a console error when getUser fails with "Failed to fetch" after pagehide (navigation abort)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // @supabase/auth-js が fetch の失敗を包み直した形（AuthRetryableFetchError相当）
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
    })
    window.dispatchEvent(new Event('pagehide'))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('ユーザー情報の取得に失敗しました')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  // 境目のテスト: pagehide が無ければ、同じ AuthRetryableFetchError('Failed to fetch') でも
  // ページ移動と無関係なふつうの通信失敗として今までどおり記録する
  it('should still log a console error for AuthRetryableFetchError("Failed to fetch") when there was no pagehide', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('ユーザー情報の取得に失敗しました')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('should set the user when getUser succeeds', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@example.com' } },
      error: null,
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.user?.id).toBe('user-1')
    expect(result.current.error).toBe(null)
  })

  it('should return the exact {user, loading, error} shape', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(Object.keys(result.current).sort()).toEqual(['error', 'loading', 'user'])
  })

  it('should not flip loading back to true on remount when the query is already cached (cache-first)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    // Shared QueryClient simulates the persisted/shared cache across mounts.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    })
    const wrapper = createWrapper(queryClient)

    const first = renderHook(() => useCurrentUser(), { wrapper })
    await waitFor(() => {
      expect(first.result.current.loading).toBe(false)
    })
    expect(first.result.current.user?.id).toBe('user-1')
    first.unmount()

    mockGetUser.mockClear()

    // Remount with a fresh hook instance sharing the same (warm) query cache.
    const second = renderHook(() => useCurrentUser(), { wrapper })

    // Cache-first: loading must never be observed as true again once cache is warm.
    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.user?.id).toBe('user-1')

    await waitFor(() => {
      expect(second.result.current.loading).toBe(false)
    })
  })

  it('should reflect user as null when the currentUser query cache is cleared (e.g. SIGNED_OUT)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(() => useCurrentUser(), { wrapper })
    await waitFor(() => {
      expect(result.current.user?.id).toBe('user-1')
    })

    // Simulate QueryProvider's SIGNED_OUT handling: setQueryData(['currentUser'], null)
    queryClient.setQueryData(['currentUser'], null)

    await waitFor(() => {
      expect(result.current.user).toBe(null)
    })
  })
})
