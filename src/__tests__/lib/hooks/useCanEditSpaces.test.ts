import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanEditSpaces } from '@/lib/hooks/useCanEditSpace'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

// マイタスクのように「複数のspaceにまたがるタスク一覧」で、タスクごとに
// space の役割が違うケースに対応するための、まとめて判定するhook。
// 単発の useCanEditSpace(spaceId) と違い、N個のhookを呼ぶことなく
// 事前に取得済みのユーザーの所属space一覧(useUserSpaces)から判定する。

let mockSpaces: { id: string; role: 'admin' | 'editor' | 'viewer' | 'client' }[] = []
let mockLoading = false

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: mockSpaces, loading: mockLoading, error: null, refetch: async () => {} }),
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
  mockSpaces = []
  mockLoading = false
})

describe('useCanEditSpaces', () => {
  it('社内メンバー(member)で、その space の役割が editor なら編集できる', () => {
    mockSpaces = [{ id: 'space-a', role: 'editor' }]
    const { result } = renderHook(() => useCanEditSpaces(), { wrapper: createWrapper('member') })
    expect(result.current.canEditSpace('space-a')).toBe(true)
  })

  it('社内メンバーで、その space の役割が viewer なら編集できない', () => {
    mockSpaces = [{ id: 'space-a', role: 'viewer' }]
    const { result } = renderHook(() => useCanEditSpaces(), { wrapper: createWrapper('member') })
    expect(result.current.canEditSpace('space-a')).toBe(false)
  })

  it('一覧に無い space（行が無い）は社内メンバーなら編集者扱い', () => {
    mockSpaces = []
    const { result } = renderHook(() => useCanEditSpaces(), { wrapper: createWrapper('owner') })
    expect(result.current.canEditSpace('space-unknown')).toBe(true)
  })

  it('タスクごとに space が違えば、判定もそれぞれ別になる', () => {
    mockSpaces = [
      { id: 'space-a', role: 'editor' },
      { id: 'space-b', role: 'viewer' },
    ]
    const { result } = renderHook(() => useCanEditSpaces(), { wrapper: createWrapper('member') })
    expect(result.current.canEditSpace('space-a')).toBe(true)
    expect(result.current.canEditSpace('space-b')).toBe(false)
  })

  it('組織の役割が client（社外）なら、どの space でも編集できない', () => {
    mockSpaces = [{ id: 'space-a', role: 'admin' }]
    const { result } = renderHook(() => useCanEditSpaces(), { wrapper: createWrapper('client') })
    expect(result.current.canEditSpace('space-a')).toBe(false)
  })

  it('spaceId が null/undefined なら編集できない', () => {
    const { result } = renderHook(() => useCanEditSpaces(), { wrapper: createWrapper('member') })
    expect(result.current.canEditSpace(null)).toBe(false)
    expect(result.current.canEditSpace(undefined)).toBe(false)
  })

  it('読み込み中は編集できない側に倒す', () => {
    mockLoading = true
    mockSpaces = [{ id: 'space-a', role: 'editor' }]
    const { result } = renderHook(() => useCanEditSpaces(), { wrapper: createWrapper('member') })
    expect(result.current.loading).toBe(true)
    expect(result.current.canEditSpace('space-a')).toBe(false)
  })
})
