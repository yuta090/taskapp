import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAnnouncements } from '@/lib/hooks/useAnnouncements'
import { getCachedUser, invalidateCachedUser } from '@/lib/supabase/cached-auth'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

const mockGetUser = vi.fn()

/** announcements の取得チェーン（.select().eq().eq().or().order().limit()）を最後まで受け流す */
function makeQueryBuilder() {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'or', 'order']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.limit = vi.fn(async () => ({ data: [], error: null }))
  return builder
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => makeQueryBuilder(),
  }),
}))

const orgContext: ActiveOrgContextValue = {
  activeOrgId: 'org-1',
  activeOrgName: 'Org',
  activeOrgRole: 'owner',
  orgs: [],
  orgsStatus: 'verified',
  orgsRefreshFailed: false,
  switchOrg: () => {},
  loading: false,
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ActiveOrgContext.Provider, { value: orgContext }, children)
    )
  }
}

/**
 * お知らせベルはヘッダーと AppShell の両方から同時にマウントされる。
 * 認証の往復（/auth/v1/user）は共通の getCachedUser を通して1回に畳む必要がある。
 * 生の supabase.auth.getUser() を直に呼ぶと、他フックと合流できず毎回1往復増える。
 */
describe('useAnnouncements の認証往復', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateCachedUser()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  })

  it('他フックと同じ getCachedUser を通るので、認証の往復は1回で済む', async () => {
    // 別のフックが先に認証を取った状態を作る（同一タブ・5秒以内）
    await getCachedUser({ auth: { getUser: mockGetUser } })
    expect(mockGetUser).toHaveBeenCalledTimes(1)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.loading).toBe(false))

    // お知らせ取得のために認証をもう1往復してはいけない
    expect(mockGetUser).toHaveBeenCalledTimes(1)
  })
})
