import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'
import type { UserSpace } from '@/lib/hooks/useUserSpaces'

// 正本は自分の space_memberships の行（useUserSpaces）。行が無い人には例外を返す仕組みとは
// 違い、行が無ければ一覧に載らないだけなので、通信の失敗と「行が無い（社内メンバーは
// 編集者扱い）」を区別できる。分からない間は編集できない側に倒す。

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

function createWrapper(
  orgs: ActiveOrgContextValue['orgs'],
  options: { loading?: boolean; orgsStatus?: ActiveOrgContextValue['orgsStatus'] } = {}
) {
  const { loading = false, orgsStatus = 'verified' } = options
  const value: ActiveOrgContextValue = {
    activeOrgId: orgs[0]?.orgId ?? null,
    activeOrgName: orgs[0]?.orgName ?? null,
    activeOrgRole: orgs[0]?.role ?? null,
    orgs,
    orgsStatus,
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
  mockIsLoadingError = false
  mockIsError = false
  useUserSpacesMock.mockClear()
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

  it('一度も取れないまま失敗したら編集できない', () => {
    mockIsLoadingError = true
    mockSpaces = []
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(false)
  })

  // 前回取れたデータ(spaces)がある状態での裏の取り直し失敗は isLoadingError=false のまま
  // （useUserSpaces 側の仕様）。react-query の isError（裏の取り直し失敗でも true になる）を
  // 使うと、編集者の役割が一時的に読み取り専用へ後退してしまうため、isLoadingError だけを見る。
  it('前回取れた役割がある状態での裏の取り直し失敗では、編集できるまま（読み取り専用に後退しない）', () => {
    // 実物の react-query が返す形を再現: isError は true（前回のデータがある状態での
    // 裏の取り直し失敗でも true になる）だが、isLoadingError は false（前回取れているため）
    mockIsError = true
    mockIsLoadingError = false
    mockSpaces = [makeSpace({ role: 'editor' })]
    const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(result.current.canEdit).toBe(true)
  })

  it('useUserSpaces には includeArchived: true を渡す（左メニューと同じキャッシュを共有する）', () => {
    renderHook(() => useCanEditSpace('space-1', 'org-1'), {
      wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }]),
    })
    expect(useUserSpacesMock).toHaveBeenCalledWith({ includeArchived: true })
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

  // 操作ガイド（InternalOnboardingWalkthrough）向け:「役割が確定したか」。
  // ActiveOrgProvider.loading は cookie があると（orgs がまだ届いていなくても）早く false になるため、
  // それだけでは「確定した」と誤認してしまう。orgsStatus も合わせて見る必要がある。
  describe('resolved（役割が確定したか）', () => {
    it('space・組織一覧とも揃っていれば確定している', () => {
      mockSpaces = [makeSpace({ role: 'editor' })]
      const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
        wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }], { orgsStatus: 'verified' }),
      })
      expect(result.current.resolved).toBe(true)
    })

    it('space一覧がまだ取れていない間は確定していない', () => {
      mockIsPending = true
      const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
        wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }], { orgsStatus: 'verified' }),
      })
      expect(result.current.resolved).toBe(false)
    })

    it('ActiveOrgProvider.loading が false でも、組織一覧が unknown（cookieだけで確定前）なら未確定扱い', () => {
      mockSpaces = [makeSpace({ role: 'editor' })]
      const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
        wrapper: createWrapper([], { loading: false, orgsStatus: 'unknown' }),
      })
      expect(result.current.resolved).toBe(false)
    })

    it('組織一覧が cached（IDB由来）でも確定扱いにする', () => {
      mockSpaces = [makeSpace({ role: 'editor' })]
      const { result } = renderHook(() => useCanEditSpace('space-1', 'org-1'), {
        wrapper: createWrapper([{ orgId: 'org-1', orgName: 'Org', role: 'member' }], { orgsStatus: 'cached' }),
      })
      expect(result.current.resolved).toBe(true)
    })
  })
})
