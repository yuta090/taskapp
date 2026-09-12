import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOrgMembers } from '@/lib/hooks/useOrgMembers'

/**
 * useOrgMembers — 組織メンバー一人ひとりの「組織の役割」。
 * メンバー管理画面が「その人が space で選べる役割」(allowedSpaceRolesFor)を
 * 絞り込むための入力として使う。space のメンバー一覧とは別の取得。
 */

const rpcMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
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
})

describe('useOrgMembers', () => {
  it('rpc_get_org_members を呼び、user_id → role の対応表を返す', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { user_id: 'u1', display_name: 'オーナー', avatar_url: null, email: null, role: 'owner', joined_at: '2026-01-01' },
        { user_id: 'u2', display_name: 'メンバー', avatar_url: null, email: null, role: 'member', joined_at: '2026-01-02' },
      ],
      error: null,
    })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useOrgMembers('org-1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.roleByUserId.get('u1')).toBe('owner'))
    expect(result.current.roleByUserId.get('u2')).toBe('member')
    expect(rpcMock).toHaveBeenCalledWith('rpc_get_org_members', { p_org_id: 'org-1' })
  })

  it('enabled:false のときは呼びに行かない（役割を変えられない人には取らない）', () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useOrgMembers('org-1', { enabled: false }), { wrapper: Wrapper })

    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('一度も取れないまま失敗したら isLoadingError が true になる', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useOrgMembers('org-1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isLoadingError).toBe(true))
    expect(result.current.roleByUserId.size).toBe(0)
  })
})
