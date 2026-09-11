import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GitHubRepoSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/GitHubRepoSettings'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

/**
 * プロジェクト設定の GitHub連携タブ。
 *
 * リポジトリ一覧・リポジトリ名は GitHub を接続した本人（github_installations.created_by）
 * にしか見えない（RLS）。それ以外の組織メンバーには useGitHubInstallation/useGitHubRepositories
 * が空を返すため、以前は「実際は接続済みなのに未接続に見える」紛らわしい表示になっていた。
 * useGitHubConnection（社内メンバーに connected/connected_by/is_me を返す RPC）で
 * 出し分ける。
 */

process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'true'

const mockUseGitHubInstallation = vi.fn()
const mockUseGitHubRepositories = vi.fn()
const mockUseSpaceGitHubRepos = vi.fn()
const mockUseGitHubConnection = vi.fn()
const mockUseLinkRepoToSpace = vi.fn()
const mockUseUnlinkRepoFromSpace = vi.fn()
const mockUseUserName = vi.fn()

vi.mock('@/lib/hooks', () => ({
  useGitHubInstallation: (...args: unknown[]) => mockUseGitHubInstallation(...args),
  useGitHubRepositories: (...args: unknown[]) => mockUseGitHubRepositories(...args),
  useSpaceGitHubRepos: (...args: unknown[]) => mockUseSpaceGitHubRepos(...args),
  useLinkRepoToSpace: (...args: unknown[]) => mockUseLinkRepoToSpace(...args),
  useUnlinkRepoFromSpace: (...args: unknown[]) => mockUseUnlinkRepoFromSpace(...args),
  useGitHubConnection: (...args: unknown[]) => mockUseGitHubConnection(...args),
  useUserName: (...args: unknown[]) => mockUseUserName(...args),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function orgContextFixture(overrides: Partial<ActiveOrgContextValue> = {}): ActiveOrgContextValue {
  return {
    activeOrgId: 'org-1',
    activeOrgName: 'Org',
    activeOrgRole: 'member',
    orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'member' }],
    orgsStatus: 'verified',
    orgsRefreshFailed: false,
    switchOrg: vi.fn(),
    loading: false,
    ...overrides,
  }
}

function renderComponent(orgCtx: ActiveOrgContextValue = orgContextFixture()) {
  return render(
    <ActiveOrgContext.Provider value={orgCtx}>
      <GitHubRepoSettings orgId="org-1" spaceId="space-1" />
    </ActiveOrgContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseLinkRepoToSpace.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mockUseUnlinkRepoFromSpace.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mockUseUserName.mockReturnValue({ name: 'ふくだ さん', loading: false })
  // 未使用でも呼ばれるので既定値を用意しておく
  mockUseGitHubRepositories.mockReturnValue({ data: [], isLoading: false, isPending: false })
  mockUseSpaceGitHubRepos.mockReturnValue({ data: [], isLoading: false, isPending: false })
})

describe('GitHubRepoSettings — 接続していない人には出し分ける', () => {
  it('未接続・組織のオーナー: 組織設定への案内リンクを出す', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false, isPending: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: false, connectedBy: null, connectedAt: null, isMe: false },
      isLoading: false,
      isPending: false,
    })

    renderComponent(orgContextFixture({ orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'owner' }] }))

    expect(screen.getByText('組織設定で連携する')).toBeInTheDocument()
  })

  it('未接続・組織のオーナーではない: 「組織のオーナーが接続できます」だけを出す', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false, isPending: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: false, connectedBy: null, connectedAt: null, isMe: false },
      isLoading: false,
      isPending: false,
    })

    renderComponent(orgContextFixture({ orgs: [{ orgId: 'org-1', orgName: 'Org', role: 'member' }] }))

    expect(screen.getByText(/組織のオーナーが接続できます/)).toBeInTheDocument()
    expect(screen.queryByText('組織設定で連携する')).not.toBeInTheDocument()
  })

  it('接続済み・本人: 今までどおりリポジトリ一覧・追加フォームを出す', () => {
    mockUseGitHubInstallation.mockReturnValue({
      data: { id: 'install-1', account_login: 'yuta090' },
      isLoading: false,
      isPending: false,
    })
    mockUseGitHubRepositories.mockReturnValue({
      data: [{ id: 'repo-1', full_name: 'yuta090/taskapp', is_private: false }],
      isLoading: false,
      isPending: false,
    })
    mockUseSpaceGitHubRepos.mockReturnValue({ data: [], isLoading: false, isPending: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: true, connectedBy: 'user-1', connectedAt: '2026-09-01', isMe: true },
      isLoading: false,
      isPending: false,
    })

    renderComponent()

    expect(screen.getByText('yuta090')).toBeInTheDocument()
    expect(screen.getByText('リポジトリを追加')).toBeInTheDocument()
  })

  it('接続済み・本人以外: installation/リポジトリに値が入っていても、一覧・アカウント名は出さず接続者名だけ出す', () => {
    // 本人以外には RLS で0行しか返らないはずだが、空のmockだけでは「出し分けている」のか
    // 「たまたま空だった」のか区別できないため、値を入れたうえで出ないことを確かめる
    mockUseGitHubInstallation.mockReturnValue({
      data: { id: 'install-1', account_login: 'yuta090' },
      isLoading: false,
      isPending: false,
    })
    mockUseGitHubRepositories.mockReturnValue({
      data: [{ id: 'repo-1', full_name: 'yuta090/taskapp', is_private: false }],
      isLoading: false,
      isPending: false,
    })
    mockUseSpaceGitHubRepos.mockReturnValue({
      data: [{ id: 'link-1', github_repo_id: 'repo-1', sync_prs: true, github_repositories: { full_name: 'yuta090/taskapp' } }],
      isLoading: false,
      isPending: false,
    })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: true, connectedBy: 'user-9', connectedAt: '2026-09-01', isMe: false },
      isLoading: false,
      isPending: false,
    })

    renderComponent()

    expect(screen.getByText(/接続済み/)).toBeInTheDocument()
    expect(screen.getByText(/ふくだ さん/)).toBeInTheDocument()
    expect(screen.getByText(/接続した人だけができます/)).toBeInTheDocument()
    expect(screen.queryByText('yuta090')).not.toBeInTheDocument()
    expect(screen.queryByText('yuta090/taskapp')).not.toBeInTheDocument()
    expect(screen.queryByText('リポジトリを追加')).not.toBeInTheDocument()
    expect(screen.queryByText('組織設定で連携する')).not.toBeInTheDocument()
  })

  it('接続済み・本人以外: リポジトリ一覧・紐づけ済み一覧はそもそも取得しにいかない', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false, isPending: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: true, connectedBy: 'user-9', connectedAt: '2026-09-01', isMe: false },
      isLoading: false,
      isPending: false,
    })

    renderComponent()

    expect(mockUseGitHubRepositories).toHaveBeenCalledWith(undefined)
    expect(mockUseSpaceGitHubRepos).toHaveBeenCalledWith(undefined)
  })

  it('接続状態がまだ読めない(isPending)ときは、installationに値が入っていても未接続扱いにしない', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: undefined, isLoading: false, isPending: true })
    mockUseGitHubConnection.mockReturnValue({ data: undefined, isLoading: false, isPending: true })

    renderComponent()

    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
    expect(screen.queryByText('組織設定で連携する')).not.toBeInTheDocument()
  })
})
