import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useTaskGitHubIssues,
  useIssueLinkCandidates,
  useManualLinkIssue,
  useUnlinkIssue,
} from '@/lib/hooks/useGitHub'
import type { GitHubIssue, TaskGitHubIssueLink } from '@/lib/github/types'

/**
 * GitHub Issues 連携の hooks（GITHUB_ISSUES_LINK_SPEC.md §8・§9 PR1）。
 * 手動の紐づけ・解除は保存ボタンを置かない方針にならい、押した瞬間に一覧へ反映し
 * 失敗したら元に戻す（楽観的更新）。
 *
 * 表示速度レビュー(REQUEST CHANGES)の是正:
 * - 完了件数は task_github_issue_rollups を別問い合わせせず、一覧(links)の Issue の状態から数える
 *   （問い合わせを1回減らし、一覧とバッジが同じデータなのでずれない）
 * - 紐づけ候補(useIssueLinkCandidates)は space_github_repos を毎回引かず、呼び出し側が
 *   useSpaceGitHubRepos で得た repoIds を渡す（候補の取得は github_issues の1回だけ）
 * - 検索中は placeholderData で前の結果を出したまま裏で取り直す（一瞬「ありません」が出ない）
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(getResult: () => { data: any; error: any } | Promise<{ data: any; error: any }>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    ilike: () => chain,
    maybeSingle: () => Promise.resolve(getResult()),
    single: () => Promise.resolve(getResult()),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(getResult()).then(resolve, reject),
  }
  return chain
}

let linksData: TaskGitHubIssueLink[] = []
let linksError: { message: string } | null = null
let issuesData: GitHubIssue[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let issuesResultProvider: (() => { data: any; error: any } | Promise<{ data: any; error: any }>) | null = null

// useGitHub.ts はモジュールの読み込み時（トップレベル）で createClient() を1回だけ呼ぶ実装のため、
// vi.mock のファクトリが読み込まれる前に fromMock 等の実体が要る。vi.hoisted で先出しする
const { fromMock, insertMock, deleteEqMock, deleteMock } = vi.hoisted(() => {
  const fromMock = vi.fn((_table: string) => ({}) as Record<string, unknown>)
  const insertMock = vi.fn((_row: Record<string, unknown>) => Promise.resolve({ error: null as { code?: string; message: string } | null }))
  const deleteEqMock = vi.fn((_col: string, _id: string) => Promise.resolve({ error: null as { message: string } | null }))
  const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))
  return { fromMock, insertMock, deleteEqMock, deleteMock }
})

fromMock.mockImplementation((table: string) => {
  if (table === 'task_github_issue_links') {
    return {
      select: () => makeChain(() => ({ data: linksData, error: linksError })),
      insert: insertMock,
      delete: deleteMock,
    }
  }
  if (table === 'github_issues') {
    return {
      select: () => makeChain(issuesResultProvider ?? (() => ({ data: issuesData, error: null }))),
    }
  }
  return {}
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: fromMock,
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  }),
}))

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const ORIGINAL_GITHUB_ENABLED = process.env.NEXT_PUBLIC_GITHUB_ENABLED

beforeEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'true'
  linksData = []
  linksError = null
  issuesData = []
  issuesResultProvider = null
  insertMock.mockClear()
  insertMock.mockResolvedValue({ error: null })
  deleteEqMock.mockClear()
  deleteEqMock.mockResolvedValue({ error: null })
  deleteMock.mockClear()
  fromMock.mockClear()
})

afterEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = ORIGINAL_GITHUB_ENABLED
})

const TASK_ID = 'task-1'
const ORG_ID = 'org-1'

const ISSUE_A: GitHubIssue = {
  id: 'issue-a',
  org_id: ORG_ID,
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
}

describe('useTaskGitHubIssues', () => {
  it('紐づいた Issue の一覧を取得する', async () => {
    linksData = [
      {
        id: 'link-1',
        org_id: ORG_ID,
        task_id: TASK_ID,
        github_issue_id: ISSUE_A.id,
        link_type: 'auto',
        created_by: 'user-1',
        created_at: '2026-09-01T00:00:00.000Z',
        github_issues: ISSUE_A,
      },
    ]

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useTaskGitHubIssues(TASK_ID), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.data?.links).toHaveLength(1))
    expect(result.current.data?.links[0].github_issues?.title).toBe('ログインできない')
  })

  it('taskId が無ければ取得しない', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useTaskGitHubIssues(undefined), { wrapper: createWrapper(queryClient) })

    expect(fromMock).not.toHaveBeenCalled()
  })

  it('task_github_issue_rollups には問い合わせない（完了件数は一覧から数える。表示速度レビュー是正）', async () => {
    linksData = [
      {
        id: 'link-1',
        org_id: ORG_ID,
        task_id: TASK_ID,
        github_issue_id: ISSUE_A.id,
        link_type: 'auto',
        created_by: 'user-1',
        created_at: '2026-09-01T00:00:00.000Z',
        github_issues: ISSUE_A,
      },
    ]

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useTaskGitHubIssues(TASK_ID), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.data?.links).toHaveLength(1))
    expect(fromMock).not.toHaveBeenCalledWith('task_github_issue_rollups')
  })
})

describe('useIssueLinkCandidates', () => {
  it('渡された repoIds に属する Issue を返す（space_github_repos は問い合わせない）', async () => {
    issuesData = [ISSUE_A]

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useIssueLinkCandidates(['repo-1'], ''), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data?.[0].issue_number).toBe(42)
    expect(fromMock).not.toHaveBeenCalledWith('space_github_repos')
  })

  it('repoIds が空なら取得しない', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useIssueLinkCandidates([], ''), { wrapper: createWrapper(queryClient) })

    expect(fromMock).not.toHaveBeenCalled()
  })

  it('検索語を変えている間も、確定するまで前の候補を表示したまま裏で取り直す(placeholderData)', async () => {
    issuesData = [ISSUE_A]
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => useIssueLinkCandidates(['repo-1'], search),
      { wrapper: createWrapper(queryClient), initialProps: { search: '' } }
    )

    await waitFor(() => expect(result.current.data).toHaveLength(1))

    // 2回目の検索はまだ確定させない
    let resolveSecond: (v: { data: unknown; error: null }) => void = () => {}
    const pending = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveSecond = resolve
    })
    issuesResultProvider = () => pending

    rerender({ search: '42' })

    // 確定していない間も前の候補を出したまま（空にならない）
    expect(result.current.data).toEqual([ISSUE_A])
    expect(result.current.isPlaceholderData).toBe(true)

    resolveSecond({ data: [ISSUE_A], error: null })
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
  })
})

describe('useManualLinkIssue', () => {
  it('押した瞬間に一覧へ反映し（楽観的更新）、insert を link_type=manual で呼ぶ', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['task-github-issues', TASK_ID], { links: [] })

    const { result } = renderHook(() => useManualLinkIssue(), { wrapper: createWrapper(queryClient) })

    await act(async () => {
      await result.current.mutateAsync({ taskId: TASK_ID, issue: ISSUE_A, orgId: ORG_ID })
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        task_id: TASK_ID,
        github_issue_id: ISSUE_A.id,
        link_type: 'manual',
        created_by: 'user-1',
      })
    )

    const cached = queryClient.getQueryData<{ links: TaskGitHubIssueLink[] }>(['task-github-issues', TASK_ID])
    expect(cached?.links.some((l) => l.github_issue_id === ISSUE_A.id)).toBe(true)
  })

  it('失敗したら一覧を元に戻す', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'boom' } })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['task-github-issues', TASK_ID], { links: [] })

    const { result } = renderHook(() => useManualLinkIssue(), { wrapper: createWrapper(queryClient) })

    await act(async () => {
      await result.current.mutateAsync({ taskId: TASK_ID, issue: ISSUE_A, orgId: ORG_ID }).catch(() => {})
    })

    const cached = queryClient.getQueryData<{ links: TaskGitHubIssueLink[] }>(['task-github-issues', TASK_ID])
    expect(cached?.links).toEqual([])
  })
})

describe('useUnlinkIssue', () => {
  it('押した瞬間に一覧から消え（楽観的更新）、delete を呼ぶ', async () => {
    const existingLink: TaskGitHubIssueLink = {
      id: 'link-1',
      org_id: ORG_ID,
      task_id: TASK_ID,
      github_issue_id: ISSUE_A.id,
      link_type: 'manual',
      created_by: 'user-1',
      created_at: '2026-09-01T00:00:00.000Z',
      github_issues: ISSUE_A,
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['task-github-issues', TASK_ID], { links: [existingLink] })

    const { result } = renderHook(() => useUnlinkIssue(), { wrapper: createWrapper(queryClient) })

    await act(async () => {
      await result.current.mutateAsync({ linkId: 'link-1', taskId: TASK_ID })
    })

    expect(deleteEqMock).toHaveBeenCalledWith('id', 'link-1')
    const cached = queryClient.getQueryData<{ links: TaskGitHubIssueLink[] }>(['task-github-issues', TASK_ID])
    expect(cached?.links).toEqual([])
  })

  it('失敗したら一覧を元に戻す', async () => {
    deleteEqMock.mockResolvedValueOnce({ error: { message: 'boom' } })
    const existingLink: TaskGitHubIssueLink = {
      id: 'link-1',
      org_id: ORG_ID,
      task_id: TASK_ID,
      github_issue_id: ISSUE_A.id,
      link_type: 'manual',
      created_by: 'user-1',
      created_at: '2026-09-01T00:00:00.000Z',
      github_issues: ISSUE_A,
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['task-github-issues', TASK_ID], { links: [existingLink] })

    const { result } = renderHook(() => useUnlinkIssue(), { wrapper: createWrapper(queryClient) })

    await act(async () => {
      await result.current.mutateAsync({ linkId: 'link-1', taskId: TASK_ID }).catch(() => {})
    })

    const cached = queryClient.getQueryData<{ links: TaskGitHubIssueLink[] }>(['task-github-issues', TASK_ID])
    expect(cached?.links).toEqual([existingLink])
  })
})
