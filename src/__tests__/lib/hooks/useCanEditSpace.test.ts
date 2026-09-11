import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

const CURRENT_USER_ID = 'user-1'

let mockUser: { id: string } | null = { id: CURRENT_USER_ID }
let mockUserLoading = false
let mockMembers: { id: string; role: string }[] = []
let mockMembersPending = false

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser, loading: mockUserLoading, error: null }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: mockMembers,
    clientMembers: [],
    internalMembers: [],
    loading: mockMembersPending,
    isPending: mockMembersPending,
    error: null,
    refetch: async () => {},
    patchMembers: () => () => {},
    getMemberName: () => '',
  }),
}))

function createWrapper(orgRole: string | null) {
  const value: ActiveOrgContextValue = {
    activeOrgId: 'org-1',
    activeOrgName: 'Org',
    activeOrgRole: orgRole,
    orgs: [],
    orgsStatus: 'verified',
    orgsRefreshFailed: false,
    switchOrg: () => {},
    loading: false,
  }
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(ActiveOrgContext.Provider, { value }, children)
  }
}

beforeEach(() => {
  mockUser = { id: CURRENT_USER_ID }
  mockUserLoading = false
  mockMembers = []
  mockMembersPending = false
})

describe('useCanEditSpace', () => {
  it('社内メンバー(member)で space の役割が editor なら編集できる', () => {
    mockMembers = [{ id: CURRENT_USER_ID, role: 'editor' }]
    const { result } = renderHook(() => useCanEditSpace('space-1'), { wrapper: createWrapper('member') })
    expect(result.current.canEdit).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it('社内メンバーで space_memberships に行が無ければ編集できる（editor扱い）', () => {
    mockMembers = []
    const { result } = renderHook(() => useCanEditSpace('space-1'), { wrapper: createWrapper('owner') })
    expect(result.current.canEdit).toBe(true)
  })

  it('社内メンバーで space の役割が viewer なら編集できない', () => {
    mockMembers = [{ id: CURRENT_USER_ID, role: 'viewer' }]
    const { result } = renderHook(() => useCanEditSpace('space-1'), { wrapper: createWrapper('member') })
    expect(result.current.canEdit).toBe(false)
  })

  it('組織の役割が client（社外）なら編集できない', () => {
    mockMembers = [{ id: CURRENT_USER_ID, role: 'admin' }]
    const { result } = renderHook(() => useCanEditSpace('space-1'), { wrapper: createWrapper('client') })
    expect(result.current.canEdit).toBe(false)
  })

  it('読み込み中は canEdit=false・loading=true', () => {
    mockMembersPending = true
    const { result } = renderHook(() => useCanEditSpace('space-1'), { wrapper: createWrapper('member') })
    expect(result.current.loading).toBe(true)
    expect(result.current.canEdit).toBe(false)
  })

  it('spaceId が null なら編集できない', () => {
    const { result } = renderHook(() => useCanEditSpace(null), { wrapper: createWrapper('member') })
    expect(result.current.canEdit).toBe(false)
  })
})
