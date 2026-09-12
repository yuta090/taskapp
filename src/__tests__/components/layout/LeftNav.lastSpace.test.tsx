import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LeftNav } from '@/components/layout/LeftNav'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

/**
 * 受信トレイやマイタスクへ移ると、左メニューで開いていたプロジェクトが勝手に閉じてしまっていた
 * （展開の判定が URL のプロジェクトID だけだったため）。最後に開いたプロジェクトを覚えておき、
 * プロジェクト外の画面でも、次に開き直したときも、開いたままにする。
 */

const { mockUsePathname, mockUseParams } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => '/inbox'),
  mockUseParams: vi.fn((): { orgId?: string } => ({})),
}))
vi.mock('next/navigation', () => ({
  usePathname: mockUsePathname,
  useParams: mockUseParams,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useUnreadNotificationCount', () => ({
  useUnreadNotificationCount: () => ({ count: 0, pendingCount: 0, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useHydrated', () => ({ useHydrated: () => true }))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

vi.mock('@/lib/auth/signOutClient', () => ({ signOutAndLeave: vi.fn() }))

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({
    spaces: [
      { id: 'space1', name: 'タイヨーDX販売', orgId: 'org1', orgName: 'テスト組織', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      { id: 'space2', name: '別のプロジェクト', orgId: 'org1', orgName: 'テスト組織', role: 'admin', archivedAt: null, groupId: null, sortOrder: 1 },
    ],
  }),
}))

vi.mock('@/lib/hooks/useSpaceGroups', () => ({
  useSpaceGroups: () => ({
    groups: [],
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    reorderGroups: vi.fn(),
    moveSpaceToGroup: vi.fn(),
  }),
}))

vi.mock('@/components/onboarding/InternalOnboardingWalkthrough', () => ({
  resetInternalOnboarding: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/components/onboarding/SetupChecklist', () => ({
  resetSetupChecklist: vi.fn(() => Promise.resolve()),
}))

const LAST_SPACE_KEY = 'taskapp:sidebar:last-space'

function renderNav(value: Partial<ActiveOrgContextValue> = {}) {
  const base: ActiveOrgContextValue = {
    activeOrgId: 'org1',
    activeOrgName: 'テスト組織',
    activeOrgRole: 'owner',
    orgs: [{ orgId: 'org1', orgName: 'テスト組織', role: 'owner' }],
    orgsStatus: 'verified',
    orgsRefreshFailed: false,
    switchOrg: vi.fn(),
    loading: false,
  }
  return render(
    <ActiveOrgContext.Provider value={{ ...base, ...value }}>
      <LeftNav />
    </ActiveOrgContext.Provider>
  )
}

/** そのプロジェクトが展開されている＝サブナビ（ダッシュボード等）が出ている */
function isExpanded(): boolean {
  return screen.queryByText('ダッシュボード') !== null
}

beforeEach(() => {
  localStorage.clear()
  mockUsePathname.mockReturnValue('/inbox')
  mockUseParams.mockReturnValue({})
})

describe('LeftNav — 最後に開いたプロジェクトを覚える', () => {
  it('プロジェクトを開くと、そのプロジェクトを覚える', () => {
    mockUsePathname.mockReturnValue('/org1/project/space2')
    mockUseParams.mockReturnValue({ orgId: 'org1' })
    renderNav()

    expect(JSON.parse(localStorage.getItem(LAST_SPACE_KEY)!)).toEqual({ org1: 'space2' })
  })

  it('受信トレイへ移っても、最後に開いたプロジェクトは開いたまま', () => {
    localStorage.setItem(LAST_SPACE_KEY, JSON.stringify({ org1: 'space1' }))
    renderNav()

    expect(isExpanded()).toBe(true)
    expect(screen.getByText('タイヨーDX販売').closest('a')).toHaveAttribute('href', '/org1/project/space1')
  })

  it('覚えていないときは、どのプロジェクトも開かない', () => {
    renderNav()
    expect(isExpanded()).toBe(false)
  })

  it('別の組織で覚えたプロジェクトは開かない', () => {
    localStorage.setItem(LAST_SPACE_KEY, JSON.stringify({ org9: 'space1' }))
    renderNav()

    expect(isExpanded()).toBe(false)
  })

  it('URL のプロジェクトが優先される（覚えている方は開かない）', () => {
    localStorage.setItem(LAST_SPACE_KEY, JSON.stringify({ org1: 'space1' }))
    mockUsePathname.mockReturnValue('/org1/project/space2')
    mockUseParams.mockReturnValue({ orgId: 'org1' })
    renderNav()

    // 展開しているのは space2 側だけ（サブナビのリンク先で判定）
    expect(screen.getByText('ダッシュボード').closest('a')).toHaveAttribute('href', '/org1/project/space2/dashboard')
  })
})
