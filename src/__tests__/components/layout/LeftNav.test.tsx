import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LeftNav } from '@/components/layout/LeftNav'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

const { mockRouterPush, mockRouterReplace, mockUsePathname, mockUseParams } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockRouterReplace: vi.fn(),
  mockUsePathname: vi.fn(() => '/org1/project/space1'),
  mockUseParams: vi.fn((): { orgId?: string; spaceId?: string } => ({ orgId: 'org1', spaceId: 'space1' })),
}))
vi.mock('next/navigation', () => ({
  usePathname: mockUsePathname,
  useParams: mockUseParams,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace, prefetch: vi.fn(), back: vi.fn() }),
}))

const { mockUseUnreadNotificationCount } = vi.hoisted(() => ({
  mockUseUnreadNotificationCount: vi.fn(() => ({ count: 0, pendingCount: 0, loading: false, error: null, refresh: vi.fn() })),
}))
vi.mock('@/lib/hooks/useUnreadNotificationCount', () => ({
  useUnreadNotificationCount: mockUseUnreadNotificationCount,
}))

const { mockUseHydrated } = vi.hoisted(() => ({
  mockUseHydrated: vi.fn(() => true),
}))
vi.mock('@/lib/hooks/useHydrated', () => ({
  useHydrated: mockUseHydrated,
}))

let mockCurrentUser: { user_metadata?: { name?: string }; email?: string } | null = null
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockCurrentUser, loading: false, error: null }),
}))

const { mockSignOutAndLeave } = vi.hoisted(() => ({
  mockSignOutAndLeave: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/auth/signOutClient', () => ({
  signOutAndLeave: mockSignOutAndLeave,
}))

const { mockUseUserSpaces, mockRefetchSpaces } = vi.hoisted(() => ({
  mockRefetchSpaces: vi.fn(),
  mockUseUserSpaces: vi.fn(() => ({
    spaces: [
      {
        id: 'space1',
        name: 'テストプロジェクト',
        orgId: 'org1',
        orgName: 'テスト組織',
        role: 'admin',
        archivedAt: null,
        groupId: null,
        sortOrder: 0,
      },
    ],
    isPending: false,
    isLoadingError: false,
    refetch: mockRefetchSpaces,
  })),
}))
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: mockUseUserSpaces,
}))

const { mockUseSpaceGroups } = vi.hoisted(() => ({
  mockUseSpaceGroups: vi.fn(() => ({
    groups: [] as { id: string; name: string; sortOrder: number }[],
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    reorderGroups: vi.fn(),
    moveSpaceToGroup: vi.fn(),
  })),
}))
vi.mock('@/lib/hooks/useSpaceGroups', () => ({
  useSpaceGroups: mockUseSpaceGroups,
}))

function renderWithOrg(value: Partial<ActiveOrgContextValue>) {
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

describe('LeftNav — 組織アイコンは1文字（2文字だと枠からはみ出す）', () => {
  it.each([
    ['テスト組織', 'テ'],
    ['skara株式会社', 'S'],
    ['  前後に空白', '前'],
    ['😀カンパニー', '😀'],
  ])('左上のアイコン: 「%s」→「%s」', (orgName, expected) => {
    renderWithOrg({ activeOrgName: orgName })
    expect(screen.getByTestId('leftnav-workspace').firstElementChild?.textContent).toBe(expected)
  })

  it('組織名が未取得でもアイコンは1文字', () => {
    renderWithOrg({ activeOrgName: null })
    expect(screen.getByTestId('leftnav-workspace').firstElementChild?.textContent).toHaveLength(1)
  })

  it('組織切替リストのアイコンも1文字', () => {
    renderWithOrg({
      orgs: [
        { orgId: 'org1', orgName: 'テスト組織', role: 'owner' },
        { orgId: 'org2', orgName: 'skara株式会社', role: 'member' },
      ],
    })
    fireEvent.click(screen.getByTestId('leftnav-workspace'))

    const iconOf = (name: string) => screen.getByText(name).closest('button')?.firstElementChild?.textContent
    expect(iconOf('skara株式会社')).toBe('S')
    const activeRow = screen.getAllByText('テスト組織').map(el => el.closest('button')).find(b => b?.dataset.testid !== 'leftnav-workspace')
    expect(activeRow?.firstElementChild?.textContent).toBe('テ')
  })
})

describe('LeftNav — 用語統一 (M-1)', () => {
  it('サイドバーのリンクが「クライアント確認待ち」を使う', () => {
    render(<LeftNav />)
    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.queryByText('確認待ち')).not.toBeInTheDocument()
  })
})

vi.mock('@/components/onboarding/InternalOnboardingWalkthrough', () => ({
  resetInternalOnboarding: vi.fn(() => Promise.resolve()),
}))

const mockResetSetupChecklist = vi.fn(() => Promise.resolve())
vi.mock('@/components/onboarding/SetupChecklist', () => ({
  resetSetupChecklist: () => mockResetSetupChecklist(),
}))

describe('LeftNav — 常設ヘルプ導線 (初回UX改善 D)', () => {
  it('ヘルプボタンを押すとポップオーバーに3項目が表示される', () => {
    render(<LeftNav />)
    fireEvent.click(screen.getByTestId('leftnav-help-button'))

    expect(screen.getByText('操作ガイドを再表示')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '用語ガイド' })).toHaveAttribute('href', '/help#glossary')
    expect(screen.getByRole('link', { name: '使い方マニュアル' })).toHaveAttribute('href', '/help')
  })

  it('ヘルプメニューに「はじめての設定を再表示」があり、押すと非表示フラグを消して再読み込みする', async () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: reloadSpy }, writable: true })
    render(<LeftNav />)
    fireEvent.click(screen.getByTestId('leftnav-help-button'))

    fireEvent.click(screen.getByText('はじめての設定を再表示'))
    await waitFor(() => expect(mockResetSetupChecklist).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled())
  })

  it('「操作ガイドを再表示」の導線はヘルプメニューにのみ存在する（重複導線なし）', () => {
    render(<LeftNav />)
    fireEvent.click(screen.getByTestId('leftnav-help-button'))

    expect(screen.getAllByText('操作ガイドを再表示')).toHaveLength(1)
  })
})

describe('LeftNav — 名称の明確化 (初回UX改善)', () => {
  it('プロジェクト配下のサブナビは「すべてのタスク」と表記する（「タスク」単体は使わない）', () => {
    render(<LeftNav />)
    expect(screen.getByText('すべてのタスク')).toBeInTheDocument()
    expect(screen.queryByText('タスク', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('受信トレイ/マイタスクの上に「個人」セクション見出しを表示する', () => {
    render(<LeftNav />)
    expect(screen.getByText('個人')).toBeInTheDocument()
  })

  it('受信トレイ/マイタスクにはtooltip(title属性)が展開時も付与される', () => {
    render(<LeftNav />)
    expect(screen.getByText('受信トレイ').closest('a')).toHaveAttribute(
      'title',
      '承認・修正依頼・ボールの受け渡しなど、対応が必要な通知'
    )
    expect(screen.getByText('マイタスク').closest('a')).toHaveAttribute(
      'title',
      '自分が担当者になっているタスク'
    )
  })
})

/**
 * ログアウト→別ユーザーでサインインをフルリロード無しで行うと、ルート常駐のクライアント状態
 * （ActiveOrgProvider・query cache 等）が前のユーザーのデータを持ったまま残ってしまう問題の
 * 修正。あらゆるログアウト経路を signOutAndLeave() に集約し、router.push/replace はしない
 * （signOutAndLeave 自身が window.location.replace でフルページ遷移する）。
 */
describe('LeftNav — ログアウトは signOutAndLeave に集約する', () => {
  beforeEach(() => {
    mockCurrentUser = { user_metadata: { name: 'テスト太郎' }, email: 'user@example.com' }
    mockSignOutAndLeave.mockClear()
    mockRouterPush.mockClear()
    mockRouterReplace.mockClear()
  })

  it('ログアウトを押すと signOutAndLeave({ to: "/login" }) を呼び、router.push/replace は呼ばない', async () => {
    render(<LeftNav />)
    fireEvent.click(screen.getByRole('button', { name: /テスト太郎/ }))
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))

    await waitFor(() => {
      expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: '/login' })
    })
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})

/**
 * URLに [orgId] を含む画面（/project・/secretary）では、組織IDは必ずURLから取る
 * （サーバーとブラウザで同じ値になるため）。URLに組織IDが無い画面では、hydration
 * が済むまで選択中の組織(activeOrgId。cookie由来でサーバーでは必ずnull)を使わない。
 */
describe('LeftNav — 組織IDはURLを優先する（cookie由来のactiveOrgIdと食い違っても崩れない）', () => {
  afterEach(() => {
    mockUsePathname.mockReturnValue('/org1/project/space1')
    mockUseParams.mockReturnValue({ orgId: 'org1', spaceId: 'space1' })
    mockUseHydrated.mockReturnValue(true)
  })

  it('秘書ページ(/[orgId]/secretary)ではURLのorgIdを使う（activeOrgIdが別の組織でも）', () => {
    mockUsePathname.mockReturnValue('/org1/secretary')
    mockUseParams.mockReturnValue({ orgId: 'org1' })
    renderWithOrg({ activeOrgId: 'other-org', activeOrgName: '別組織' })
    expect(screen.getByText('秘書').closest('a')).toHaveAttribute('href', '/org1/secretary')
  })

  it('URLにorgIdが無い画面（/my等）ではactiveOrgIdにフォールバックする', () => {
    mockUsePathname.mockReturnValue('/my')
    mockUseParams.mockReturnValue({})
    renderWithOrg({ activeOrgId: 'org1', activeOrgName: 'テスト組織' })
    expect(screen.getByText('秘書').closest('a')).toHaveAttribute('href', '/org1/secretary')
  })

  it('URLに組織IDが無い画面では、hydrationが済むまでactiveOrgIdを使わない（サーバーでは必ずnullのため）', () => {
    mockUsePathname.mockReturnValue('/my')
    mockUseParams.mockReturnValue({})
    mockUseHydrated.mockReturnValue(false)
    renderWithOrg({ activeOrgId: 'org1', activeOrgName: 'テスト組織' })
    expect(screen.queryByText('秘書')).not.toBeInTheDocument()
  })
})

/**
 * React #418 対策: react-query の永続キャッシュ(IndexedDB)の復元が、Suspense境界の
 * 遅延ハイドレーションより先に終わることがある。その場合でも、ハイドレーション時の
 * 描画はサーバーと同じ表示（読み込み中の枠・空の一覧・バッジ無し）を保ち、
 * ハイドレーション完了直後にキャッシュの中身をすぐ出す（通信を待たない）。
 * ここでは useHydrated をモックしてその境目の挙動だけを検証する
 * （実際のハイドレーションのタイミング自体は useHydrated.test.tsx で検証済み）。
 */
describe('LeftNav — hydration前はキャッシュ由来の表示をサーバーと合わせる（React #418対策）', () => {
  beforeEach(() => {
    mockCurrentUser = { user_metadata: { name: 'テスト太郎' }, email: 'user@example.com' }
    mockUseUnreadNotificationCount.mockReturnValue({
      count: 5,
      pendingCount: 5,
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
  })

  afterEach(() => {
    mockUseHydrated.mockReturnValue(true)
    mockUseUnreadNotificationCount.mockReturnValue({
      count: 0,
      pendingCount: 0,
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        {
          id: 'space1',
          name: 'テストプロジェクト',
          orgId: 'org1',
          orgName: 'テスト組織',
          role: 'admin',
          archivedAt: null,
          groupId: null,
          sortOrder: 0,
        },
      ],
      isPending: false,
      isLoadingError: false,
      refetch: mockRefetchSpaces,
    })
    mockUseSpaceGroups.mockReturnValue({
      groups: [],
      createGroup: vi.fn(),
      renameGroup: vi.fn(),
      deleteGroup: vi.fn(),
      reorderGroups: vi.fn(),
      moveSpaceToGroup: vi.fn(),
    })
    mockRefetchSpaces.mockClear()
  })

  it('hydration前はユーザー欄をローディング表示のままにする（キャッシュに既にユーザーがいても）', () => {
    mockUseHydrated.mockReturnValue(false)
    const { container } = render(<LeftNav />)
    expect(screen.queryByText('テスト太郎')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('hydration前はプロジェクト一覧を骨組み表示にする（キャッシュに既にプロジェクトがあっても、「プロジェクトがありません」もまだ出さない）', () => {
    mockUseHydrated.mockReturnValue(false)
    const { container } = render(<LeftNav />)
    expect(screen.queryByText('テストプロジェクト')).not.toBeInTheDocument()
    expect(screen.queryByText('プロジェクトがありません')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="leftnav-spaces-skeleton"]')).toBeInTheDocument()
  })

  it('hydration後も読み込み中(isPending)の間は骨組み表示のままで、「プロジェクトがありません」は出さない', () => {
    mockUseUserSpaces.mockReturnValue({ spaces: [], isPending: true, isLoadingError: false, refetch: mockRefetchSpaces })
    const { container } = render(<LeftNav />)
    expect(screen.queryByText('プロジェクトがありません')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="leftnav-spaces-skeleton"]')).toBeInTheDocument()
  })

  it('読み込みが終わって本当に0件のときだけ「プロジェクトがありません」を表示する', () => {
    mockUseUserSpaces.mockReturnValue({ spaces: [], isPending: false, isLoadingError: false, refetch: mockRefetchSpaces })
    const { container } = render(<LeftNav />)
    expect(screen.getByText('プロジェクトがありません')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="leftnav-spaces-skeleton"]')).not.toBeInTheDocument()
  })

  it('一度も取得できないまま失敗したときは「プロジェクトがありません」ではなく再読み込みの案内を出す（本当はあるのに作り直させない）', () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [],
      isPending: false,
      isLoadingError: true,
      refetch: mockRefetchSpaces,
    })
    render(<LeftNav />)
    expect(screen.queryByText('プロジェクトがありません')).not.toBeInTheDocument()
    expect(screen.getByText('プロジェクトを読み込めませんでした')).toBeInTheDocument()

    fireEvent.click(screen.getByText('再読み込み'))
    expect(mockRefetchSpaces).toHaveBeenCalledTimes(1)
  })

  it('グループの取得が一覧より先に終わっても、読み込み中はグループ内の「プロジェクトなし」を出さない', () => {
    mockUseUserSpaces.mockReturnValue({ spaces: [], isPending: true, isLoadingError: false, refetch: mockRefetchSpaces })
    mockUseSpaceGroups.mockReturnValue({
      groups: [{ id: 'group1', name: 'グループA', sortOrder: 0 }],
      createGroup: vi.fn(),
      renameGroup: vi.fn(),
      deleteGroup: vi.fn(),
      reorderGroups: vi.fn(),
      moveSpaceToGroup: vi.fn(),
    })
    const { container } = render(<LeftNav />)
    expect(screen.getByText('グループA')).toBeInTheDocument()
    expect(screen.queryByText('プロジェクトなし')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="leftnav-spaces-skeleton"]')).toBeInTheDocument()
  })

  it('hydration前は未読バッジを出さない（キャッシュに既に未読があっても）', () => {
    mockUseHydrated.mockReturnValue(false)
    render(<LeftNav />)
    expect(screen.queryByText('5')).not.toBeInTheDocument()
  })

  it('hydration後はキャッシュの中身をすぐに表示する（通信を待たない）', () => {
    mockUseHydrated.mockReturnValue(true)
    render(<LeftNav />)
    expect(screen.getByText('テスト太郎')).toBeInTheDocument()
    expect(screen.getByText('テストプロジェクト')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
