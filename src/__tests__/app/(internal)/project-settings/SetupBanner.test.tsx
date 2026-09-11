import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SetupBanner } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/SetupBanner'

/**
 * プロジェクトセットアップバナーの「外部ツールを連携」ステップ。
 *
 * 以前は useGitHubInstallation（GitHub を接続した本人にしか行が返らない RLS 付きの表）
 * だけで完了判定していたため、GitHub は接続済みでも、接続した本人以外には
 * 「外部ツールを連携」が未完了に見えていた。useGitHubConnection（社内メンバーに
 * connected を返す RPC）も見て判定する。
 */

const mockUseGitHubInstallation = vi.fn()
const mockUseGitHubConnection = vi.fn()
const mockUseSlackWorkspace = vi.fn()
const mockUseSpaceRow = vi.fn()
const mockUseSpaceContentCounts = vi.fn()

vi.mock('@/lib/hooks/useGitHub', () => ({
  useGitHubInstallation: (...args: unknown[]) => mockUseGitHubInstallation(...args),
  useGitHubConnection: (...args: unknown[]) => mockUseGitHubConnection(...args),
}))

vi.mock('@/lib/hooks/useSlack', () => ({
  useSlackWorkspace: (...args: unknown[]) => mockUseSlackWorkspace(...args),
}))

vi.mock('@/lib/hooks/useSpaceRow', () => ({
  useSpaceRow: (...args: unknown[]) => mockUseSpaceRow(...args),
}))

vi.mock('@/lib/hooks/useSpaceContentCounts', () => ({
  useSpaceContentCounts: (...args: unknown[]) => mockUseSpaceContentCounts(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockUseSlackWorkspace.mockReturnValue({ data: null })
  mockUseSpaceRow.mockReturnValue({ space: { preset_genre: 'blank' }, isPending: false })
  // members=1（自分だけ）・milestones=0 → 「メンバー」「マイルストーン」は未完了のまま、
  // 「外部ツールを連携」の判定だけを見るため他は固定する
  mockUseSpaceContentCounts.mockReturnValue({
    counts: { members: 1, wikiPages: 0, milestones: 0 },
    isPending: false,
    isError: false,
  })
})

function renderBanner() {
  return render(
    <SetupBanner orgId="org-1" spaceId="space-1" onNavigate={vi.fn()} activeConnectionCount={0} />
  )
}

describe('SetupBanner — GitHub接続済み・本人以外', () => {
  it('本人以外でも、GitHub接続済みなら「外部ツールを連携」を完了扱いにする', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: true, connectedBy: 'user-9', connectedAt: '2026-09-01', isMe: false },
      isLoading: false,
    })

    renderBanner()

    expect(screen.getByText('1/3 完了')).toBeInTheDocument()
    expect(screen.queryByText('Slack, GitHub, カレンダーなど')).not.toBeInTheDocument()
  })

  it('未接続なら今までどおり「外部ツールを連携」は未完了のまま', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: false, connectedBy: null, connectedAt: null, isMe: false },
      isLoading: false,
    })

    renderBanner()

    expect(screen.getByText('0/3 完了')).toBeInTheDocument()
    expect(screen.getByText('Slack, GitHub, カレンダーなど')).toBeInTheDocument()
  })
})

describe('SetupBanner — GitHub接続状態の読み込み判定(isLoading)', () => {
  it('GitHubの接続状態を実際に取得中(isLoading)は、判定が定まるまでバナーを出さない', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false })
    mockUseGitHubConnection.mockReturnValue({ data: undefined, isLoading: true })

    renderBanner()

    expect(screen.queryByText('プロジェクトセットアップ')).not.toBeInTheDocument()
  })

  it('GitHub未設定環境（問い合わせ自体をしない）では、isPendingが永久trueでもバナーは出る', () => {
    // クエリが enabled:false のとき、isLoading は false のまま(何も取りにいっていない)だが
    // isPending は永久に true のまま。isPending を条件に使うと、この環境ではバナーが
    // 二度と表示されなくなってしまう
    mockUseGitHubInstallation.mockReturnValue({ data: null, isLoading: false, isPending: true })
    mockUseGitHubConnection.mockReturnValue({ data: undefined, isLoading: false, isPending: true })

    renderBanner()

    expect(screen.getByText('プロジェクトセットアップ')).toBeInTheDocument()
  })
})
