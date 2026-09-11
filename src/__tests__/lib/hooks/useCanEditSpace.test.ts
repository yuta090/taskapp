import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'
import type { UserSpace } from '@/lib/hooks/useUserSpaces'

// 正本は自分の space_memberships の行（useUserSpaces）。rpc_get_space_members のように
// 「行が無い人には例外」ではなく「行が無ければ一覧に載らないだけ」なので、通信断・失敗と
// 「行が無い（社内メンバーは編集者扱い）」を区別できる。分からない間は編集できない側に倒す。

let mockSpaces: UserSpace[] = []
let mockIsPending = false
let mockIsError = false

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: mockSpaces,
    loading: mockIsPending,
    isPending: mockIsPending,
    isError: mockIsError,
    error: null,
    refetch: async () => {},
  }),
}))

function makeSpace(overrides: Partial<UserSpace> = {}): UserSpace {
  return {
    id: 'space-1',
    name: 'テストスペース',
    orgId: 'org-1',
    orgName: 'テスト組織',
    role: 'editor',
    archivedAt: null,
    groupId: null,
    sortOrder: 0,
    ...overrides,
  }
}

function createWrapper(orgs: ActiveOrgContextValue['orgs'], loading = false) {
  const value: ActiveOrgContextValue = {
    activeOrgId: orgs[0]?.orgId ?? null,
    activeOrgName: orgs[0]?.orgName ?? null,
    activeOrgRole: orgs[0]?.role ?? null,
    orgs,
    orgsStatus: 'verified',
    orgsRefreshFailed: false,
    switchOrg: () => {},
    loading,
  }
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(ActiveOrgContext.Provider, { value }, children)
  }
}

beforeEach(() => {
  mockSpaces = []
  mockIsPending = false
  mockIsError = false
})

describe('useCanEditSpace', () => {
  it('社内メンバー(member)で space の役割が editor なら編集できる', () => {
    mockSpaces = [makeSpace({ role: 'editor' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it('行が無い社内メンバーは編集できる（editor扱い）', () => {
    mockSpaces = []
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'owner' }]),
    })
    expect(result.current.canEdit).toBe(true)
  })

  it('space の役割が viewer なら編集できない', () => {
    mockSpaces = [makeSpace({ role: 'viewer' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(false)
  })

  it('アーカイブ済み space の閲覧者は編集できない', () => {
    mockSpaces = [makeSpace({ role: 'viewer', archivedAt: '2026-01-01T00:00:00Z' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(false)
  })

  it('組織の役割が client（社外）なら編集できない', () => {
    mockSpaces = [makeSpace({ role: 'admin' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'client' }]),
    })
    expect(result.current.canEdit).toBe(false)
  })

  it('閲覧者で取得に失敗したら編集できない（例外で「行が無い＝編集者」に倒れない）', () => {
    mockIsError = true
    mockSpaces = []
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(false)
  })

  it('まだ取れていない間は canEdit=false・loading=true', () => {
    mockIsPending = true
    mockSpaces = [makeSpace({ role: 'editor' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.loading).toBe(true)
    expect(result.current.canEdit).toBe(false)
  })

  it('spaceId が null なら編集できない', () => {
    const { result } = renderHook(() => useCanEditSpace(null, 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(false)
  })

  it('組織の役割が引けない（orgIdがorgsに無い）ときは編集できない側に倒す', () => {
    mockSpaces = [makeSpace({ role: 'editor', orgId: 'org-unknown' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-unknown'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(false)
  })

  it('「今選んでいる組織」ではなく、渡された orgId（そのページの組織）の役割を使う', () => {
    // activeOrgId は org-1（役割 viewer=社外相当ではないが判定に使ってはいけない）で、
    // このページは org-2（役割 member）を見ている、というズレを再現する
    mockSpaces = [makeSpace({ role: 'editor', orgId: 'org-2' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-2'), {
      wrapper: createWrapper([
        { orgId: 'org-1', orgName: 'Org1', role: 'client' },
        { orgId: 'org-2', orgName: 'Org2', role: 'member' },
      ]),
    })
    expect(result.current.canEdit).toBe(true)
  })

  describe('canEditMoney（価格の枠・代理店設定）', () => {
    it('space の役割が admin/editor なら操作できる', () => {
      mockSpaces = [makeSpace({ role: 'admin' })]
      const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
        wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
      })
      expect(result.current.canEditMoney).toBe(true)
    })

    it('行が無い社内メンバーは操作できない（canEditと違いeditor扱いにしない）', () => {
      mockSpaces = []
      const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
        wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'owner' }]),
      })
      expect(result.current.canEdit).toBe(true)
      expect(result.current.canEditMoney).toBe(false)
    })
  })
})
