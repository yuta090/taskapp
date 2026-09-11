import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskPRList } from '@/components/github/TaskPRList'
import type { GitHubPullRequest, TaskGitHubLink } from '@/lib/github/types'

/**
 * PR-B: リポジトリ一覧・リポジトリ名は GitHub を接続した本人にしか見せない
 * （制作会社の顧客名がリポジトリ名から類推できるため）。author_login は
 * authenticated から誰にも読めなくなった列なので、そもそも画面に出ない。
 *
 * 表示速度レビューの是正: 「本人だけに見せる」は既に RLS（github_repositories は
 * 接続した本人だけが読める）で守られており、埋め込みの full_name の有無がそのまま
 * 判定結果になる。isMe を使う判定は常に「full_name があれば出す」と同じ結果にしかならず
 * 組織ごとに無駄な RPC を1回増やすだけだったため、useGitHubConnection は呼ばない
 * （hook 自体は次の PR-C の設定画面・連携画面向けに残す）。
 */

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))

let mockLinks: TaskGitHubLink[] = []
let mockIsLoading = false
const mockUseTaskGitHubLinks = vi.fn(() => ({ data: mockLinks, isLoading: mockIsLoading }))

let mockSpacePRs: GitHubPullRequest[] = []
const mockUseSpacePullRequests = vi.fn(() => ({ data: mockSpacePRs }))

const mockUseGitHubConnection = vi.fn(() => ({ data: { connected: true, connectedBy: 'someone', connectedAt: null, isMe: true } }))

const mockLinkMutateAsync = vi.fn(() => Promise.resolve())
const mockUnlinkMutateAsync = vi.fn(() => Promise.resolve())

vi.mock('@/lib/hooks', () => ({
  useTaskGitHubLinks: () => mockUseTaskGitHubLinks(),
  useSpacePullRequests: () => mockUseSpacePullRequests(),
  useManualLinkPR: () => ({ mutateAsync: mockLinkMutateAsync, isPending: false }),
  useUnlinkPR: () => ({ mutateAsync: mockUnlinkMutateAsync, isPending: false }),
  useGitHubConnection: () => mockUseGitHubConnection(),
}))

const ORIGINAL_GITHUB_ENABLED = process.env.NEXT_PUBLIC_GITHUB_ENABLED

function makePR(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    id: 'pr-1',
    org_id: 'org-1',
    github_repo_id: 'repo-1',
    pr_number: 42,
    pr_title: 'ログイン機能の実装',
    pr_state: 'open',
    additions: 10,
    deletions: 2,
    commits_count: 3,
    pr_created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeLink(pr: GitHubPullRequest | undefined, overrides: Partial<TaskGitHubLink> = {}): TaskGitHubLink {
  return {
    id: 'link-1',
    org_id: 'org-1',
    task_id: 'task-1',
    github_pr_id: pr?.id ?? 'pr-1',
    link_type: 'auto',
    created_by: 'user-1',
    created_at: '2026-09-01T00:00:00.000Z',
    github_pull_requests: pr,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'true'
  mockLinks = []
  mockIsLoading = false
  mockSpacePRs = []
  toastSuccess.mockClear()
  toastError.mockClear()
  mockUseGitHubConnection.mockClear()
})

afterEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = ORIGINAL_GITHUB_ENABLED
})

describe('TaskPRList', () => {
  it('リポジトリの埋め込み(full_name)がある行は、リポジトリ名とGitHubへのリンクを出す', () => {
    const pr = makePR({ github_repositories: { id: 'repo-1', org_id: 'org-1', installation_id: 1, repo_id: 1, owner_login: 'yuta090', repo_name: 'taskapp', full_name: 'yuta090/taskapp', default_branch: 'main', is_private: false, created_at: '', updated_at: '' } })
    mockLinks = [makeLink(pr)]

    render(<TaskPRList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.getByText('yuta090/taskapp')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/yuta090/taskapp/pull/42')
  })

  it('埋め込み(full_name)が無い行は、リポジトリ名・リンクを出さず番号とタイトルだけにする', () => {
    const pr = makePR({ github_repositories: undefined })
    mockLinks = [makeLink(pr)]

    render(<TaskPRList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.getByText('ログイン機能の実装')).toBeInTheDocument()
    expect(screen.queryByText('yuta090/taskapp')).not.toBeInTheDocument()
    expect(screen.queryByText(/github\.com/)).not.toBeInTheDocument()
  })

  it('埋め込みが null の行があっても落ちない', () => {
    mockLinks = [makeLink(makePR({ id: 'pr-2', github_repositories: undefined }))]

    expect(() => render(<TaskPRList taskId="task-1" spaceId="space-1" orgId="org-1" />)).not.toThrow()
  })

  it('useGitHubConnection を呼ばない（本人判定は RLS の埋め込みの有無だけで足りるため、無駄なRPCを出さない）', () => {
    mockLinks = [makeLink(makePR())]

    render(<TaskPRList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(mockUseGitHubConnection).not.toHaveBeenCalled()
  })
})
