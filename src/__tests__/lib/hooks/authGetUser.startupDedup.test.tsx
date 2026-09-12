import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOnboardingFlag } from '@/lib/hooks/useOnboardingFlag'
import { useUnreadNotificationCount } from '@/lib/hooks/useUnreadNotificationCount'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

/**
 * 起動時のユーザー確認（案A）: 別々のフックが起動直後に同時にマウントされても、
 * 認証サーバーへの往復（getUser）は共有キャッシュ（getCachedUser・実物を使う。
 * ここではモックしない）で1回に畳まれることを確かめる。
 * getSession→getUser(token) の二段構成そのものは cached-auth.test.ts で別途検証済み。
 */

const mockGetUser = vi.fn()
const mockGetSession = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: mockFrom,
  }),
}))

const orgContext: ActiveOrgContextValue = {
  activeOrgId: null,
  activeOrgName: null,
  activeOrgRole: null,
  orgs: [],
  orgsStatus: 'verified',
  orgsRefreshFailed: false,
  switchOrg: () => {},
  loading: false,
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ActiveOrgContext.Provider, { value: orgContext }, children)
    )
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateCachedUser()
  localStorage.clear()
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'tok-1', user: { id: 'user-1' } } },
    error: null,
  })
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  // notifications クエリの select().eq().eq().is() チェーンを最後まで受け流す
  const notificationsBuilder: { then: (resolve: (v: unknown) => void) => void; eq: () => unknown; in: () => unknown } = {
    then: (resolve) => resolve({ count: 0, error: null }),
    eq: () => notificationsBuilder,
    in: () => notificationsBuilder,
  }
  mockFrom.mockImplementation((table: string) => {
    if (table === 'notifications') {
      return { select: () => notificationsBuilder }
    }
    // profiles.onboarding_flags 参照（useOnboardingFlag）
    return {
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { onboarding_flags: {} }, error: null }),
        }),
      }),
    }
  })
})

describe('起動時のユーザー確認は複数フックが同時に動いても1回で済む', () => {
  it('useOnboardingFlag と useUnreadNotificationCount を同時にマウントしても、getUser は1回だけ呼ばれる', async () => {
    const wrapper = createWrapper()
    const onboarding = renderHook(
      () => useOnboardingFlag('internal_walkthrough', 'taskapp_test_onboarded_dedup'),
      { wrapper }
    )
    const unreadCount = renderHook(() => useUnreadNotificationCount(), { wrapper })

    await waitFor(() => expect(onboarding.result.current.shouldShow).not.toBeNull())
    await waitFor(() => expect(unreadCount.result.current.loading).toBe(false))

    expect(mockGetUser).toHaveBeenCalledTimes(1)
  })
})
