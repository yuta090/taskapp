import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskIssueList } from '@/components/github/TaskIssueList'
import type { GitHubIssue, TaskGitHubIssueLink } from '@/lib/github/types'

/**
 * PR-B: リポジトリ一覧・リポジトリ名は GitHub を接続した本人にしか見せない。
 * 作者・担当者(author_login/assignee_logins)は authenticated から誰も読めなくなった列
 * なので、そもそも画面に出ない（型からも削除済み）。
 *
 * 表示速度レビューの是正: 「本人だけに見せる」は既に RLS（github_repositories は
 * 接続した本人だけが読める）で守られており、埋め込みの full_name の有無がそのまま
 * 判定結果になる。useGitHubConnection は呼ばない（hook 自体は次の PR-C の
 * 設定画面・連携画面向けに残す）。
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let mockIssuesData: { links: TaskGitHubIssueLink[] } | undefined
const mockUseGitHubConnection = vi.fn(() => ({
  data: { connected: true, connectedBy: 'someone', connectedAt: null, isMe: true },
}))

vi.mock('@/lib/hooks', () => ({
  useTaskGitHubIssues: () => ({ data: mockIssuesData, isLoading: false }),
  useSpaceGitHubRepos: () => ({ data: [] }),
  useIssueLinkCandidates: () => ({ data: [], isLoading: false }),
  useManualLinkIssue: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkIssue: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGitHubConnection: () => mockUseGitHubConnection(),
}))

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 'issue-1',
    org_id: 'org-1',
    github_repo_id: 'repo-1',
    issue_number: 42,
    title: 'ログインできない',
    state: 'open',
    state_reason: null,
    issue_created_at: '2026-09-01T00:00:00.000Z',
    closed_at: null,
    github_updated_at: '2026-09-01T00:00:00.000Z',
    last_synced_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeLink(issue: GitHubIssue): TaskGitHubIssueLink {
  return {
    id: 'link-1',
    org_id: 'org-1',
    task_id: 'task-1',
    github_issue_id: issue.id,
    link_type: 'auto',
    created_by: 'user-1',
    created_at: '2026-09-01T00:00:00.000Z',
    github_issues: issue,
  }
}

const ORIGINAL_GITHUB_ENABLED = process.env.NEXT_PUBLIC_GITHUB_ENABLED

beforeEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'true'
  mockIssuesData = { links: [] }
  mockUseGitHubConnection.mockClear()
})

afterEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = ORIGINAL_GITHUB_ENABLED
})

describe('TaskIssueList — PR-B 出し分け', () => {
  it('リポジトリの埋め込み(full_name)がある行は、リポジトリ名とGitHubへのリンクを出す', () => {
    const issue = makeIssue({
      github_repositories: {
        id: 'repo-1', org_id: 'org-1', installation_id: 1, repo_id: 1,
        owner_login: 'yuta090', repo_name: 'taskapp', full_name: 'yuta090/taskapp',
        default_branch: 'main', is_private: false, created_at: '', updated_at: '',
      },
    })
    mockIssuesData = { links: [makeLink(issue)] }

    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.getByText('yuta090/taskapp')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/yuta090/taskapp/issues/42')
  })

  it('埋め込み(full_name)が無い行は、リポジトリ名・リンクを出さず番号・タイトル・状態・日付だけにする', () => {
    const issue = makeIssue({ github_repositories: undefined })
    mockIssuesData = { links: [makeLink(issue)] }

    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.getByText('ログインできない')).toBeInTheDocument()
    expect(screen.getByText('開いている')).toBeInTheDocument()
    expect(screen.queryByText('yuta090/taskapp')).not.toBeInTheDocument()
    expect(screen.queryByText(/github\.com/)).not.toBeInTheDocument()
  })

  it('リポジトリの埋め込みが null（プロジェクトから外れた等）でも落ちない', () => {
    const issue = makeIssue({ github_repositories: undefined })
    mockIssuesData = { links: [makeLink(issue)] }

    expect(() => render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)).not.toThrow()
  })

  it('useGitHubConnection を呼ばない（無駄なRPCを出さない）', () => {
    const issue = makeIssue({ github_repositories: undefined })
    mockIssuesData = { links: [makeLink(issue)] }

    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(mockUseGitHubConnection).not.toHaveBeenCalled()
  })
})
