import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskIssueList } from '@/components/github/TaskIssueList'
import type { GitHubIssue, TaskGitHubIssueLink, TaskGitHubIssueRollup } from '@/lib/github/types'

/**
 * TaskIssueList — タスク詳細の GitHub セクション（TaskPRList の下）に出す Issue 一覧。
 * GITHUB_ISSUES_LINK_SPEC.md §8・§9 PR1。
 * - 紐づいた Issue の一覧・状態（開いている／完了／見送り）・「N件中M件完了」バッジ
 * - 紐づけ（番号/タイトルで検索して選ぶ・その場で開く選択欄）・解除（確認ダイアログ）
 * - GitHub 連携が無効、または紐づいた Issue が無く readOnly のときは何も出さない
 */

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}))

let mockIssuesData: { links: TaskGitHubIssueLink[]; rollup: TaskGitHubIssueRollup | null } | undefined
let mockIsLoading = false
const mockUseTaskGitHubIssues = vi.fn((_taskId: string | undefined) => ({
  data: mockIssuesData,
  isLoading: mockIsLoading,
}))

let mockCandidates: GitHubIssue[] = []
const mockUseIssueLinkCandidates = vi.fn((_spaceId: string | undefined, search: string) => {
  const trimmed = search.trim().replace(/^#/, '')
  const filtered = trimmed
    ? mockCandidates.filter(
        (i) => i.title.includes(trimmed) || String(i.issue_number) === trimmed
      )
    : mockCandidates
  return { data: filtered }
})

const mockLinkMutateAsync = vi.fn(() => Promise.resolve())
const mockUseManualLinkIssue = vi.fn(() => ({ mutateAsync: mockLinkMutateAsync, isPending: false }))

const mockUnlinkMutateAsync = vi.fn(() => Promise.resolve())
const mockUseUnlinkIssue = vi.fn(() => ({ mutateAsync: mockUnlinkMutateAsync, isPending: false }))

vi.mock('@/lib/hooks', () => ({
  useTaskGitHubIssues: (taskId: string | undefined) => mockUseTaskGitHubIssues(taskId),
  useIssueLinkCandidates: (spaceId: string | undefined, search: string) =>
    mockUseIssueLinkCandidates(spaceId, search),
  useManualLinkIssue: () => mockUseManualLinkIssue(),
  useUnlinkIssue: () => mockUseUnlinkIssue(),
}))

const ORIGINAL_GITHUB_ENABLED = process.env.NEXT_PUBLIC_GITHUB_ENABLED

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 'issue-1',
    org_id: 'org-1',
    github_repo_id: 'repo-1',
    issue_number: 42,
    title: 'ログインできない',
    url: 'https://github.com/yuta090/taskapp/issues/42',
    state: 'open',
    state_reason: null,
    author_login: 'yuta090',
    assignee_logins: [],
    issue_created_at: '2026-09-01T00:00:00.000Z',
    closed_at: null,
    github_updated_at: '2026-09-01T00:00:00.000Z',
    last_synced_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeLink(issue: GitHubIssue, overrides: Partial<TaskGitHubIssueLink> = {}): TaskGitHubIssueLink {
  return {
    id: `link-${issue.id}`,
    org_id: 'org-1',
    task_id: 'task-1',
    github_issue_id: issue.id,
    link_type: 'auto',
    created_by: 'user-1',
    created_at: '2026-09-01T00:00:00.000Z',
    github_issues: issue,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'true'
  mockIssuesData = { links: [], rollup: null }
  mockIsLoading = false
  mockCandidates = []
  mockLinkMutateAsync.mockClear()
  mockLinkMutateAsync.mockResolvedValue(undefined)
  mockUnlinkMutateAsync.mockClear()
  mockUnlinkMutateAsync.mockResolvedValue(undefined)
  toastSuccess.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = ORIGINAL_GITHUB_ENABLED
})

describe('TaskIssueList', () => {
  it('GitHub 連携が無効なら何も表示しない', () => {
    process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'false'
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.queryByTestId('task-issue-list')).not.toBeInTheDocument()
  })

  it('紐づいた Issue が無く readOnly のときは何も表示しない', () => {
    mockIssuesData = { links: [], rollup: null }
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" readOnly />)

    expect(screen.queryByTestId('task-issue-list')).not.toBeInTheDocument()
  })

  it('紐づいた Issue が無くても編集可なら「紐付けられていません」を表示する', () => {
    mockIssuesData = { links: [], rollup: null }
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.getByTestId('task-issue-list')).toBeInTheDocument()
    expect(screen.getByText('Issueが紐付けられていません')).toBeInTheDocument()
  })

  it('開いている／完了／見送りの状態を表示する', () => {
    const openIssue = makeIssue({ id: 'i-open', issue_number: 1, state: 'open', state_reason: null })
    const doneIssue = makeIssue({ id: 'i-done', issue_number: 2, state: 'closed', state_reason: null })
    const skippedIssue = makeIssue({ id: 'i-skip', issue_number: 3, state: 'closed', state_reason: 'not_planned' })
    mockIssuesData = {
      links: [makeLink(openIssue), makeLink(doneIssue), makeLink(skippedIssue)],
      rollup: null,
    }

    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.getByText('開いている')).toBeInTheDocument()
    expect(screen.getByText('完了')).toBeInTheDocument()
    expect(screen.getByText('見送り')).toBeInTheDocument()
  })

  it('「N件中M件完了」のバッジを表示する', () => {
    mockIssuesData = {
      links: [makeLink(makeIssue())],
      rollup: {
        task_id: 'task-1',
        org_id: 'org-1',
        open_count: 1,
        completed_count: 2,
        not_planned_count: 1,
        all_closed_at: null,
        notified_at: null,
        updated_at: '2026-09-01T00:00:00.000Z',
      },
    }

    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    expect(screen.getByTestId('task-issue-rollup-badge')).toHaveTextContent('4件中2件完了')
  })

  it('紐付けボタンを押すと検索欄が開き、候補を選ぶと紐づく', async () => {
    mockCandidates = [makeIssue({ id: 'i-candidate', issue_number: 99, title: 'ログインの不具合' })]
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    fireEvent.click(screen.getByTestId('task-issue-link-button'))
    expect(screen.getByTestId('task-issue-search-input')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('task-issue-candidate-99'))

    await waitFor(() =>
      expect(mockLinkMutateAsync).toHaveBeenCalledWith({
        taskId: 'task-1',
        issue: mockCandidates[0],
        orgId: 'org-1',
      })
    )
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('検索語で候補を番号・タイトルで絞れる', () => {
    mockCandidates = [
      makeIssue({ id: 'i-1', issue_number: 1, title: 'ログインできない' }),
      makeIssue({ id: 'i-2', issue_number: 2, title: '検索が遅い' }),
    ]
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)
    fireEvent.click(screen.getByTestId('task-issue-link-button'))

    expect(screen.getByTestId('task-issue-candidate-1')).toBeInTheDocument()
    expect(screen.getByTestId('task-issue-candidate-2')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('task-issue-search-input'), { target: { value: '2' } })

    expect(screen.queryByTestId('task-issue-candidate-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-issue-candidate-2')).toBeInTheDocument()
  })

  it('解除ボタン→確認ダイアログで確定すると解除される', async () => {
    const issue = makeIssue()
    mockIssuesData = { links: [makeLink(issue, { id: 'link-1' })], rollup: null }
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    fireEvent.click(screen.getByTestId('task-issue-unlink-42'))
    const confirmButton = await screen.findByRole('button', { name: '解除' })
    fireEvent.click(confirmButton)

    await waitFor(() =>
      expect(mockUnlinkMutateAsync).toHaveBeenCalledWith({ linkId: 'link-1', taskId: 'task-1' })
    )
  })

  it('解除の確認でキャンセルすると解除しない', async () => {
    const issue = makeIssue()
    mockIssuesData = { links: [makeLink(issue, { id: 'link-1' })], rollup: null }
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" />)

    fireEvent.click(screen.getByTestId('task-issue-unlink-42'))
    const cancelButton = await screen.findByRole('button', { name: 'キャンセル' })
    fireEvent.click(cancelButton)

    expect(mockUnlinkMutateAsync).not.toHaveBeenCalled()
  })

  it('readOnly のときは紐付け・解除の操作を出さない', () => {
    mockIssuesData = { links: [makeLink(makeIssue())], rollup: null }
    render(<TaskIssueList taskId="task-1" spaceId="space-1" orgId="org-1" readOnly />)

    expect(screen.queryByTestId('task-issue-link-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-issue-unlink-42')).not.toBeInTheDocument()
  })
})
