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
// 組織の役割は、その space 自身の orgId（useUserSpaces が持つ）を優先し、
// 一覧に無い space（行が無い）では canEditSpace の第2引数（呼び出し側が渡す orgId、
// 例: task.org_id）で補う。単発の useCanEditSpace と同じ考え方（詳細と一覧の判定が
// ずれないようにする）。

let mockSpaces: UserSpace[] = []
let mockIsPending = false
let mockIsLoadingError = false
// react-query の isError は「一度も取れないまま失敗した」ときも「前回取れたデータがある
// 状態で裏の取り直しだけ失敗した」ときも true になる（isLoadingError と違い区別しない）。
// モックでもその実物の形（isError:true かつ isLoadingError:false かつ spaces は前回分が残る）
// を再現し、hook が isError を見てしまう後退を検出できるようにする。
let mockIsError = false

const useUserSpacesMock = vi.fn<(options?: { includeArchived?: boolean }) => Record<string, unknown>>(() => ({
  spaces: mockSpaces,
  loading: mockIsPending,
  isPending: mockIsPending,
  isLoadingError: mockIsLoadingError,
  isError: mockIsError,
  error: null,
  refetch: async () => {},
}))

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: (options?: { includeArchived?: boolean }) => useUserSpacesMock(options),
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
  mockIsLoadingError = false
  mockIsError = false
  useUserSpacesMock.mockClear()
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

  it('一覧に無い space（行が無い）で orgId を渡さなければ、組織が分からず編集できない側に倒す', () => {
    mockSpaces = []
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'owner' }]),
    })
    expect(result.current.canEditSpace('space-unknown')).toBe(false)
  })

  it('一覧に無い space（行が無い社内メンバー）でも、呼び出し側が orgId を渡せば編集できる（useCanEditSpace と同じ挙動）', () => {
    mockSpaces = []
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'owner' }]),
    })
    expect(result.current.canEditSpace('space-unknown', 'org-1')).toBe(true)
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

  it('space の行が見つかれば、渡された orgId より一覧側の orgId を優先する', () => {
    mockSpaces = [makeSpace({ id: 'space-a', role: 'admin', orgId: 'org-1' })]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([
        { orgId: 'org-1', orgName: 'Org1', role: 'member' },
        { orgId: 'org-2', orgName: 'Org2', role: 'client' },
      ]),
    })
    // 呼び出し側が誤って別の org-2 を渡しても、一覧に載っている本当の所属(org-1)で判定する
    expect(result.current.canEditSpace('space-a', 'org-2')).toBe(true)
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

  it('一度も取れないまま失敗したときは編集できない側に倒す', () => {
    mockIsLoadingError = true
    mockSpaces = [makeSpace({ id: 'space-a', role: 'editor', orgId: 'org-1' })]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEditSpace('space-a')).toBe(false)
  })

  it('前回取れた役割がある状態での裏の取り直し失敗では、編集できるまま', () => {
    // 実物の react-query が返す形を再現: isError は true（前回のデータがある状態での
    // 裏の取り直し失敗でも true になる）だが、isLoadingError は false（前回取れているため）
    mockIsError = true
    mockIsLoadingError = false
    mockSpaces = [makeSpace({ id: 'space-a', role: 'editor', orgId: 'org-1' })]
    const { result } = renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEditSpace('space-a')).toBe(true)
  })

  it('useUserSpaces には includeArchived: true を渡す（左メニューと同じキャッシュを共有する）', () => {
    renderHook(() => useCanEditSpaces(), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(useUserSpacesMock).toHaveBeenCalledWith({ includeArchived: true })
  })
})
