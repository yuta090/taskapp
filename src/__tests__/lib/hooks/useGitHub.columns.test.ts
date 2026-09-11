import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useGitHubInstallation,
  useGitHubRepositories,
  useSpaceGitHubRepos,
  useTaskGitHubLinks,
  useSpacePullRequests,
  useTaskGitHubIssues,
  useIssueLinkCandidates,
  useGitHubConnection,
} from '@/lib/hooks/useGitHub'

/**
 * PR-B: GitHub の表を読む select から `*` と、authenticated が読めない列
 * （pr_url, url, head_branch, base_branch, author_login, author_avatar_url,
 *  assignee_logins, access_token, token_expires_at）を締め出す。
 *
 * このコードは列権限の migration が本番に当たる前でも後でも動く必要があるため、
 * 「許可列だけを名指しする」形に直っていることを select 文字列で検証する
 * （migration 適用後は select('*') は permission denied で全滅するため）。
 */

const FORBIDDEN_COLUMNS = [
  'pr_url',
  'url',
  'head_branch',
  'base_branch',
  'author_login',
  'author_avatar_url',
  'assignee_logins',
  'access_token',
  'token_expires_at',
]

function assertSafeSelect(selectArg: string) {
  // select('*') はもちろん、埋め込みの中の `*`（例: `github_repositories (*)`）も許さない
  expect(selectArg).not.toMatch(/(^|[(,\s])\*/)
  for (const col of FORBIDDEN_COLUMNS) {
    expect(selectArg).not.toMatch(new RegExp(`\\b${col}\\b`))
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(getResult: () => { data: any; error: any } | Promise<{ data: any; error: any }>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: (...args: unknown[]) => {
      selectCalls.push(args[0] as string)
      return chain
    },
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

let selectCalls: string[] = []
let resultData: unknown = []
let resultError: { message: string } | null = null

const { fromMock, rpcMock } = vi.hoisted(() => {
  const fromMock = vi.fn((_table: string) => ({}) as Record<string, unknown>)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpcMock = vi.fn((): Promise<{ data: any; error: any }> => Promise.resolve({ data: null, error: null }))
  return { fromMock, rpcMock }
})

fromMock.mockImplementation(() => ({
  select: (...args: unknown[]) => makeChain(() => ({ data: resultData, error: resultError })).select(...args),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: fromMock,
    rpc: rpcMock,
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
  selectCalls = []
  resultData = []
  resultError = null
  fromMock.mockClear()
  rpcMock.mockClear()
  rpcMock.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  process.env.NEXT_PUBLIC_GITHUB_ENABLED = ORIGINAL_GITHUB_ENABLED
})

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('useGitHubInstallation', () => {
  it('access_token / token_expires_at を含まない列だけを select する', async () => {
    const qc = newClient()
    renderHook(() => useGitHubInstallation('org-1'), { wrapper: createWrapper(qc) })
    await waitFor(() => expect(selectCalls.length).toBeGreaterThan(0))
    assertSafeSelect(selectCalls[0])
  })
})

describe('useGitHubRepositories', () => {
  it('select(*) を使わない', async () => {
    const qc = newClient()
    renderHook(() => useGitHubRepositories('org-1'), { wrapper: createWrapper(qc) })
    await waitFor(() => expect(selectCalls.length).toBeGreaterThan(0))
    assertSafeSelect(selectCalls[0])
  })
})

describe('useSpaceGitHubRepos', () => {
  it('埋め込み github_repositories(*) も含めて select(*) を使わない', async () => {
    const qc = newClient()
    renderHook(() => useSpaceGitHubRepos('space-1'), { wrapper: createWrapper(qc) })
    await waitFor(() => expect(selectCalls.length).toBeGreaterThan(0))
    assertSafeSelect(selectCalls[0])
  })
})

describe('useTaskGitHubLinks', () => {
  it('github_pull_requests の埋め込みから pr_url / author_login 等を締め出す', async () => {
    const qc = newClient()
    renderHook(() => useTaskGitHubLinks('task-1'), { wrapper: createWrapper(qc) })
    await waitFor(() => expect(selectCalls.length).toBeGreaterThan(0))
    assertSafeSelect(selectCalls[0])
  })
})

describe('useSpacePullRequests', () => {
  it('github_pull_requests から許可列だけを select する', async () => {
    resultData = [{ github_repo_id: 'repo-1' }]
    const qc = newClient()
    renderHook(() => useSpacePullRequests('space-1'), { wrapper: createWrapper(qc) })
    await waitFor(() => expect(selectCalls.length).toBeGreaterThanOrEqual(2))
    for (const call of selectCalls) assertSafeSelect(call)
  })
})

describe('useTaskGitHubIssues', () => {
  it('github_issues の埋め込みから url / author_login / assignee_logins を締め出す', async () => {
    const qc = newClient()
    renderHook(() => useTaskGitHubIssues('task-1'), { wrapper: createWrapper(qc) })
    await waitFor(() => expect(selectCalls.length).toBeGreaterThan(0))
    assertSafeSelect(selectCalls[0])
  })
})

describe('useIssueLinkCandidates', () => {
  it('github_issues から許可列だけを select する', async () => {
    const qc = newClient()
    renderHook(() => useIssueLinkCandidates(['repo-1'], ''), { wrapper: createWrapper(qc) })
    await waitFor(() => expect(selectCalls.length).toBeGreaterThan(0))
    assertSafeSelect(selectCalls[0])
  })
})

describe('useGitHubConnection', () => {
  it('RPC github_connection_status を p_org で呼ぶ', async () => {
    rpcMock.mockResolvedValue({
      data: [{ connected: true, connected_by: 'user-1', connected_at: '2026-09-01T00:00:00.000Z', is_me: true }],
      error: null,
    })
    const qc = newClient()
    const { result } = renderHook(() => useGitHubConnection('org-1'), { wrapper: createWrapper(qc) })

    await waitFor(() => expect(result.current.data?.connected).toBe(true))
    expect(rpcMock).toHaveBeenCalledWith('github_connection_status', { p_org: 'org-1' })
    expect(result.current.data).toEqual({
      connected: true,
      connectedBy: 'user-1',
      connectedAt: '2026-09-01T00:00:00.000Z',
      isMe: true,
    })
  })

  it('未接続なら isMe=false・connected=false を返す', async () => {
    rpcMock.mockResolvedValue({
      data: [{ connected: false, connected_by: null, connected_at: null, is_me: false }],
      error: null,
    })
    const qc = newClient()
    const { result } = renderHook(() => useGitHubConnection('org-1'), { wrapper: createWrapper(qc) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.connected).toBe(false)
    expect(result.current.data?.isMe).toBe(false)
  })

  it('orgId が無ければ呼ばない', () => {
    const qc = newClient()
    renderHook(() => useGitHubConnection(undefined), { wrapper: createWrapper(qc) })
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
