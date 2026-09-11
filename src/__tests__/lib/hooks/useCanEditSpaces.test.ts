import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanEditSpaces } from '@/lib/hooks/useCanEditSpace'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'
import type { UserSpace } from '@/lib/hooks/useUserSpaces'

// マイタスクのように「複数のspaceにまたがるタスク一覧」で、タスクごとに
// space の役割が違うケースに対応するための、まとめて判定するhook。
// 単発の useCanEditSpace(spaceId, orgId) と違い、N個のhookを呼ぶことなく
// 事前に取得済みのユーザーの所属space一覧(useUserSpaces)から判定する。
// 組織の役割は「今選んでいる組織」ではなく、useUserSpaces が持つ各spaceのorgIdから引く
// （呼び出し側からorgIdを渡す手段が無いため、行が無いspaceは判定できず false に倒す）。

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
    id: 'space-a',
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

function createWrapper(orgs: ActiveOrgContextValue['orgs']) {
  const value: ActiveOrgContextValue = {
    activeOrgId: orgs[0]?.orgId ?? null,
    activeOrgName: orgs[0]?.orgName ?? null,
    activeOrgRole: orgs[0]?.role ?? null,
    orgs,
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
  mockSpaces = []
  mockIsPending = false
  mockIsError = false
})

describe('useCanEditSpaces', () => {
  it('社内メンバー(member)で、その space の役割が editor なら編集できる', () => {
    mockSpaces = [makeSpace({ id: 'space-a', role: 'editor', orgId: 'org-1' })]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEditSpace('space-a')).toBe(true)
  })

  it('社内メンバーで、その space の役割が viewer なら編集できない', () => {
    mockSpaces = [makeSpace({ id: 'space-a', role: 'viewer', orgId: 'org-1' })]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEditSpace('space-a')).toBe(false)
  })

  it('一覧に無い space（行が無い）は、組織が分からないため編集できない側に倒す', () => {
    mockSpaces = []
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'owner' }]),
    })
    expect(result.current.canEditSpace('space-unknown')).toBe(false)
  })

  it('タスクごとに space が違えば、判定もそれぞれ別になる', () => {
    mockSpaces = [
      makeSpace({ id: 'space-a', role: 'editor', orgId: 'org-1' }),
      makeSpace({ id: 'space-b', role: 'viewer', orgId: 'org-1' }),
    ]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEditSpace('space-a')).toBe(true)
    expect(result.current.canEditSpace('space-b')).toBe(false)
  })

  it('space ごとに所属組織が違えば、その組織の役割で判定する', () => {
    mockSpaces = [
      makeSpace({ id: 'space-a', role: 'admin', orgId: 'org-1' }),
      makeSpace({ id: 'space-b', role: 'admin', orgId: 'org-2' }),
    ]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([
        { orgId: 'org-1', orgName: 'Org1', role: 'member' },
        { orgId: 'org-2', orgName: 'Org2', role: 'client' },
      ]),
    })
    expect(result.current.canEditSpace('space-a')).toBe(true)
    expect(result.current.canEditSpace('space-b')).toBe(false)
  })

  it('spaceId が null/undefined なら編集できない', () => {
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEditSpace(null)).toBe(false)
    expect(result.current.canEditSpace(undefined)).toBe(false)
  })

  it('まだ取れていない間は編集できない側に倒す', () => {
    mockIsPending = true
    mockSpaces = [makeSpace({ id: 'space-a', role: 'editor', orgId: 'org-1' })]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.loading).toBe(true)
    expect(result.current.canEditSpace('space-a')).toBe(false)
  })

  it('取得に失敗したときも編集できない側に倒す', () => {
    mockIsError = true
    mockSpaces = [makeSpace({ id: 'space-a', role: 'editor', orgId: 'org-1' })]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEditSpace('space-a')).toBe(false)
  })
})
