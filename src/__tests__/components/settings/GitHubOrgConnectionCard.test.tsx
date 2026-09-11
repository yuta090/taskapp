import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GitHubOrgConnectionCard } from '@/components/settings/GitHubOrgConnectionCard'

/**
 * 組織設定(外部連携)の GitHub カード。
 *
 * リポジトリ一覧・リポジトリ名は GitHub を接続した本人にしか見えない（RLS）ため、
 * useGitHubInstallation だけで判定すると、本人以外には常に「未接続」に見えてしまう。
 * useGitHubConnection（社内メンバーに connected/connected_by/is_me を返す RPC）で出し分ける。
 */

const mockUseGitHubInstallation = vi.fn()
const mockUseGitHubConnection = vi.fn()
const mockUseUserName = vi.fn()

vi.mock('@/lib/hooks/useGitHub', () => ({
  useGitHubInstallation: (...args: unknown[]) => mockUseGitHubInstallation(...args),
  useGitHubConnection: (...args: unknown[]) => mockUseGitHubConnection(...args),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useUserName: (...args: unknown[]) => mockUseUserName(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseUserName.mockReturnValue({ name: 'ふくだ さん', loading: false })
})

describe('GitHubOrgConnectionCard', () => {
  it('未接続・オーナー: 接続ボタンを出す', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false, isPending: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: false, connectedBy: null, connectedAt: null, isMe: false },
      isLoading: false,
      isPending: false,
    })

    render(<GitHubOrgConnectionCard orgId="org-1" isOwner />)

    expect(screen.getByRole('link', { name: /GitHubと連携する/ })).toBeInTheDocument()
  })

  it('未接続・オーナーではない: 「組織のオーナーが接続できます」だけを出す', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false, isPending: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: false, connectedBy: null, connectedAt: null, isMe: false },
      isLoading: false,
      isPending: false,
    })

    render(<GitHubOrgConnectionCard orgId="org-1" isOwner={false} />)

    expect(screen.getByText(/組織のオーナーが接続できます/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /GitHubと連携する/ })).not.toBeInTheDocument()
  })

  it('接続済み・本人: 連携中のアカウント名と設定変更リンクを出す', () => {
    mockUseGitHubInstallation.mockReturnValue({
      data: { id: 'install-1', account_login: 'yuta090' },
      isLoading: false,
      isPending: false,
    })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: true, connectedBy: 'user-1', connectedAt: '2026-09-01', isMe: true },
      isLoading: false,
      isPending: false,
    })

    render(<GitHubOrgConnectionCard orgId="org-1" isOwner />)

    expect(screen.getByText('yuta090')).toBeInTheDocument()
  })

  it('接続済み・本人以外: installationに値が入っていても、アカウント名は出さず接続した人の名前だけ出す', () => {
    // 本人以外には github_installations は RLS で0行しか返らないはずだが、
    // 万一 mock/実装のズレで値が入っていても画面には出さないことを確かめる
    // （空のmockだけでは「出し分けている」のか「たまたま空だった」のか区別できない）
    mockUseGitHubInstallation.mockReturnValue({
      data: { id: 'install-1', account_login: 'yuta090' },
      isLoading: false,
      isPending: false,
    })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: true, connectedBy: 'user-9', connectedAt: '2026-09-01', isMe: false },
      isLoading: false,
      isPending: false,
    })

    render(<GitHubOrgConnectionCard orgId="org-1" isOwner={false} />)

    expect(screen.getByText(/接続済みです/)).toBeInTheDocument()
    expect(screen.getByText(/ふくだ さん/)).toBeInTheDocument()
    expect(screen.getByText(/接続した人だけができます/)).toBeInTheDocument()
    expect(screen.queryByText('yuta090')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /GitHubと連携する/ })).not.toBeInTheDocument()
  })

  it('接続状態がまだ読めない(isPending)ときは、installationに値が入っていても未接続扱いにしない', () => {
    // IDBからの復元直後など、isLoading(実際に通信中)ではないが isPending(まだデータが無い)
    // というタイミングがある。ここで「未接続＋接続ボタン」を出すと、実際は接続済みでも
    // 一瞬「未接続」に見えてしまう
    mockUseGitHubInstallation.mockReturnValue({ data: undefined, isLoading: false, isPending: true })
    mockUseGitHubConnection.mockReturnValue({ data: undefined, isLoading: false, isPending: true })

    render(<GitHubOrgConnectionCard orgId="org-1" isOwner />)

    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /GitHubと連携する/ })).not.toBeInTheDocument()
  })
})
