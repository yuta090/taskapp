import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubPullRequestPayload, GitHubInstallationPayload, GitHubIssuePayload } from './types'

/**
 * handlePullRequestEvent — PR が取り込まれた(closed+merged)ときだけ、
 * つなぎ漏れ拾い(linkPRToTasks)と社内通知(notifyTasksForMergedPR)を実行する。
 * merged=false の close・opened・edited では通知しない（既存の動きを変えない）。
 */

const ORG_ID = 'org-1'
const REPO_ROW_ID = 'repo-row-1'
const PR_ROW_ID = 'pr-row-1'
const ISSUE_ROW_ID = 'issue-row-1'

const linkPRToTasksMock = vi.fn(() => Promise.resolve({ linkedTasks: [] }))
const linkIssueToTasksMock = vi.fn(() => Promise.resolve({ linkedTasks: [] }))
const notifyTasksForMergedPRMock = vi.fn((..._args: unknown[]) => Promise.resolve())

let updateInstallationPatch: Record<string, unknown> | null = null
let updateInstallationError: { message: string } | null = null
const updateInstallationEqMock = vi.fn(() =>
  Promise.resolve({ error: updateInstallationError }),
)
const updateInstallationMock = vi.fn((patch: Record<string, unknown>) => {
  updateInstallationPatch = patch
  return { eq: updateInstallationEqMock }
})

// github_repositories: org_id + repo_id(GitHub側の数値ID) から内部の行IDを引く。
// transferred のテストで「転送先が同じ org にある/無い」を出し分けるため repo_id ごとに設定できるようにする
let repoRowsByRepoId: Record<number, { id: string } | null> = { 1: { id: REPO_ROW_ID } }

// github_issues: 自動紐づけ(TP-番号)の直前に github_issue_id を引く select と、
// deleted / transferred で使う delete / update
let issueLookupResult: { id: string } | null = { id: ISSUE_ROW_ID }
let issueOpError: { message: string } | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chainResolvingError(): any {
  const chain = {
    eq: () => chain,
    then: (resolve: (v: unknown) => void) => resolve({ error: issueOpError }),
  }
  return chain
}
const issueDeleteMock = vi.fn(() => chainResolvingError())
const issueUpdateMock = vi.fn((_patch: Record<string, unknown>) => chainResolvingError())

// github_apply_issue_state RPC
let rpcData: unknown[] = []
let rpcError: { message: string } | null = null
const rpcMock = vi.fn((_fnName: string, _params: Record<string, unknown>) =>
  Promise.resolve({ data: rpcData, error: rpcError }),
)

// 「tasks 行には一切書かない」（GITHUB_ISSUES_LINK_SPEC §6-3）を固定するため、
// アクセスされた表名をすべて記録する
let tableAccessLog: string[] = []

vi.mock('./task-linker', () => ({
  linkPRToTasks: linkPRToTasksMock,
  linkIssueToTasks: linkIssueToTasksMock,
}))

vi.mock('./merge-notify', () => ({
  notifyTasksForMergedPR: notifyTasksForMergedPRMock,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      tableAccessLog.push(table)
      if (table === 'github_installations') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { org_id: ORG_ID }, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => updateInstallationMock(patch),
        }
      }
      if (table === 'github_repositories') {
        return {
          select: () => ({
            eq: () => ({
              eq: (_col: string, repoId: number) => ({
                single: () => Promise.resolve({ data: repoRowsByRepoId[repoId] ?? null, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'github_pull_requests') {
        return {
          upsert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: PR_ROW_ID }, error: null }),
            }),
          }),
        }
      }
      if (table === 'github_issues') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: issueLookupResult, error: null }),
              }),
            }),
          }),
          delete: issueDeleteMock,
          update: issueUpdateMock,
        }
      }
      if (table === 'tasks') {
        // handleIssueEvent / handlePullRequestEvent から tasks 行への書き込みは絶対に無い前提
        return {
          update: () => {
            throw new Error('tasks.update must never be called from GitHub webhook handlers (§6-3)')
          },
        }
      }
      return {}
    }),
    rpc: (...args: [string, Record<string, unknown>]) => rpcMock(...args),
  })),
}))

function makePayload(overrides: Partial<GitHubPullRequestPayload['pull_request']> & { action?: string }): GitHubPullRequestPayload {
  const { action, ...prOverrides } = overrides
  return {
    action: action ?? 'closed',
    number: 42,
    pull_request: {
      id: 999,
      number: 42,
      title: 'fix: login bug',
      html_url: 'https://github.com/yuta090/taskapp/pull/42',
      state: 'closed',
      merged: false,
      body: null,
      user: { login: 'yuta090', avatar_url: '' },
      head: { ref: 'fix/login' },
      base: {
        ref: 'main',
        repo: { id: 1, name: 'taskapp', full_name: 'yuta090/taskapp', owner: { login: 'yuta090' } },
      },
      additions: 1,
      deletions: 1,
      commits: 1,
      merged_at: null,
      closed_at: '2026-09-10T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
      ...prOverrides,
    },
    repository: { id: 1, name: 'taskapp', full_name: 'yuta090/taskapp', owner: { login: 'yuta090' } },
    installation: { id: 123 },
  }
}

async function load() {
  vi.resetModules()
  return await import('./handlers')
}

beforeEach(() => {
  vi.clearAllMocks()
  linkPRToTasksMock.mockResolvedValue({ linkedTasks: [] })
  linkIssueToTasksMock.mockResolvedValue({ linkedTasks: [] })
  notifyTasksForMergedPRMock.mockResolvedValue(undefined)
  updateInstallationPatch = null
  updateInstallationError = null
  repoRowsByRepoId = { 1: { id: REPO_ROW_ID } }
  issueLookupResult = { id: ISSUE_ROW_ID }
  issueOpError = null
  rpcData = []
  rpcError = null
  tableAccessLog = []
})

describe('handlePullRequestEvent', () => {
  it('closed + merged=true: linkPRToTasks と通知処理の両方が呼ばれる', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ merged: true, state: 'closed', merged_at: '2026-09-10T00:00:00.000Z' })

    const result = await handlePullRequestEvent(payload)

    expect(result.success).toBe(true)
    expect(linkPRToTasksMock).toHaveBeenCalledTimes(1)
    expect(linkPRToTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      REPO_ROW_ID,
      PR_ROW_ID,
      'fix: login bug',
      null,
      'fix/login',
    )
    expect(notifyTasksForMergedPRMock).toHaveBeenCalledTimes(1)
    expect(notifyTasksForMergedPRMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: ORG_ID,
        prId: PR_ROW_ID,
        prNumber: 42,
        prTitle: 'fix: login bug',
      }),
    )
    // リポジトリ名・GitHubのURLは社内通知に渡さない（ユーザー絶対条件）
    const notifyArg = notifyTasksForMergedPRMock.mock.calls[0][1] as Record<string, unknown>
    expect(notifyArg).not.toHaveProperty('prUrl')
    expect(notifyArg).not.toHaveProperty('repoFullName')
  })

  it('closed + merged=false: 通知処理は呼ばれない（取り込まれずに閉じただけ）', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ merged: false, state: 'closed' })

    await handlePullRequestEvent(payload)

    expect(notifyTasksForMergedPRMock).not.toHaveBeenCalled()
  })

  it('opened: linkPRToTasks は呼ばれるが通知処理は呼ばれない（既存の動きを変えない）', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ action: 'opened', state: 'open', merged: false })

    await handlePullRequestEvent(payload)

    expect(linkPRToTasksMock).toHaveBeenCalledTimes(1)
    expect(notifyTasksForMergedPRMock).not.toHaveBeenCalled()
  })

  it('opened: ブランチ名(pr.head.ref)も linkPRToTasks に渡す（タイトル/本文に無くても紐づけられるように）', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({
      action: 'opened',
      state: 'open',
      merged: false,
      title: 'ちょっとした修正',
      head: { ref: 'feat/tp-42-login' },
    })

    await handlePullRequestEvent(payload)

    expect(linkPRToTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      REPO_ROW_ID,
      PR_ROW_ID,
      'ちょっとした修正',
      null,
      'feat/tp-42-login',
    )
  })

  it('edited: linkPRToTasks は呼ばれるが通知処理は呼ばれない', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ action: 'edited', state: 'open', merged: false })

    await handlePullRequestEvent(payload)

    expect(linkPRToTasksMock).toHaveBeenCalledTimes(1)
    expect(notifyTasksForMergedPRMock).not.toHaveBeenCalled()
  })
})

/**
 * handleInstallationEvent — `new_permissions_accepted` で導入先の許可範囲を保存する
 * （GITHUB_ISSUES_LINK_SPEC.md §5・§7.6・§9 PR0b）。
 * 列（permissions / permissions_updated_at）がまだ本番に無くても webhook 処理は止めない。
 */
describe('handleInstallationEvent', () => {
  function makePayload(
    overrides: Partial<GitHubInstallationPayload['installation']> = {},
  ): GitHubInstallationPayload {
    return {
      action: 'new_permissions_accepted',
      installation: {
        id: 123,
        account: { login: 'yuta090', type: 'User' },
        permissions: { pull_requests: 'read', issues: 'write', metadata: 'read' },
        ...overrides,
      },
    } as GitHubInstallationPayload
  }

  it('許可範囲と更新時刻を github_installations に保存する', async () => {
    const { handleInstallationEvent } = await load()

    const result = await handleInstallationEvent(makePayload())

    expect(result.success).toBe(true)
    expect(updateInstallationMock).toHaveBeenCalledTimes(1)
    expect(updateInstallationPatch).toMatchObject({
      permissions: { pull_requests: 'read', issues: 'write', metadata: 'read' },
    })
    expect(typeof updateInstallationPatch?.permissions_updated_at).toBe('string')
    expect(updateInstallationEqMock).toHaveBeenCalledWith('installation_id', 123)
  })

  it('列がまだ無い等で更新が失敗しても、処理は止めない（success のまま）', async () => {
    updateInstallationError = { message: 'column "permissions" does not exist' }
    const { handleInstallationEvent } = await load()

    const result = await handleInstallationEvent(makePayload())

    expect(result.success).toBe(true)
  })
})

/**
 * handleIssueEvent — Issue の書き換えと、紐づく全タスクの再計算を1回の RPC
 * （github_apply_issue_state）で行う。TP-番号の自動紐づけは opened/edited のみ。
 * deleted / transferred は RPC を使わず github_issues を直接操作する。
 * tasks 行は一切書かない（GITHUB_ISSUES_LINK_SPEC.md §6-3・§7.1・§7.2・§9 PR1）。
 */
describe('handleIssueEvent', () => {
  function makeIssuePayload(
    overrides: Partial<GitHubIssuePayload['issue']> = {},
    extra: {
      action?: GitHubIssuePayload['action']
      changes?: GitHubIssuePayload['changes']
      repository?: GitHubIssuePayload['repository']
    } = {}
  ): GitHubIssuePayload {
    return {
      action: extra.action ?? 'opened',
      issue: {
        id: 555,
        number: 7,
        title: 'ログインできない',
        body: null,
        html_url: 'https://github.com/yuta090/taskapp/issues/7',
        state: 'open',
        state_reason: null,
        user: { login: 'yuta090' },
        assignees: [],
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-10T00:00:00.000Z',
        closed_at: null,
        ...overrides,
      },
      changes: extra.changes,
      repository: extra.repository ?? {
        id: 1,
        name: 'taskapp',
        full_name: 'yuta090/taskapp',
        owner: { login: 'yuta090' },
      },
      installation: { id: 123 },
    }
  }

  it('opened: github_apply_issue_state を正しい引数で1回呼ぶ', async () => {
    const { handleIssueEvent } = await load()
    const payload = makeIssuePayload({
      title: 'ログインできない',
      body: null,
      state: 'open',
      state_reason: null,
      user: { login: 'yuta090' },
      assignees: [{ login: 'alice' }, { login: 'bob' }],
    })

    const result = await handleIssueEvent(payload)

    expect(result.success).toBe(true)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('github_apply_issue_state', {
      p_org_id: ORG_ID,
      p_github_repo_id: REPO_ROW_ID,
      p_issue_number: 7,
      p_title: 'ログインできない',
      p_url: 'https://github.com/yuta090/taskapp/issues/7',
      p_state: 'open',
      p_state_reason: null,
      p_author_login: 'yuta090',
      p_assignee_logins: ['alice', 'bob'],
      p_issue_created_at: '2026-09-01T00:00:00.000Z',
      p_closed_at: null,
      p_github_updated_at: '2026-09-10T00:00:00.000Z',
    })
  })

  it('pull_request 付きの payload は無視する（PRをIssueとして受け取った場合）', async () => {
    const { handleIssueEvent } = await load()
    const payload = makeIssuePayload({ pull_request: { url: 'https://api.github.com/repos/x/y/pulls/7' } })

    const result = await handleIssueEvent(payload)

    expect(result.success).toBe(true)
    expect(rpcMock).not.toHaveBeenCalled()
    expect(linkIssueToTasksMock).not.toHaveBeenCalled()
  })

  it('知らないリポジトリは無視する', async () => {
    const { handleIssueEvent } = await load()
    const payload = makeIssuePayload(
      {},
      { repository: { id: 999, name: 'unknown', full_name: 'x/unknown', owner: { login: 'x' } } }
    )

    const result = await handleIssueEvent(payload)

    expect(result.success).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('deleted: github_issues の行を削除し、RPCは呼ばない', async () => {
    const { handleIssueEvent } = await load()
    const payload = makeIssuePayload({ number: 7 }, { action: 'deleted' })

    const result = await handleIssueEvent(payload)

    expect(result.success).toBe(true)
    expect(issueDeleteMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('transferred: 転送先が同じ org の github_repositories にあれば repo・番号・URLを書き換える', async () => {
    repoRowsByRepoId[2] = { id: 'repo-row-2' }
    const { handleIssueEvent } = await load()
    const payload = makeIssuePayload(
      { number: 7 },
      {
        action: 'transferred',
        changes: {
          new_repository: { id: 2, name: 'new-repo', full_name: 'yuta090/new-repo', owner: { login: 'yuta090' } },
          new_issue: { number: 21 },
        },
      }
    )

    const result = await handleIssueEvent(payload)

    expect(result.success).toBe(true)
    expect(issueUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        github_repo_id: 'repo-row-2',
        issue_number: 21,
        url: 'https://github.com/yuta090/new-repo/issues/21',
      })
    )
    expect(issueDeleteMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('transferred: 転送先が同じ org に無ければ削除扱い', async () => {
    const { handleIssueEvent } = await load()
    const payload = makeIssuePayload(
      { number: 7 },
      {
        action: 'transferred',
        changes: {
          new_repository: { id: 404, name: 'elsewhere', full_name: 'other/elsewhere', owner: { login: 'other' } },
        },
      }
    )

    const result = await handleIssueEvent(payload)

    expect(result.success).toBe(true)
    expect(issueDeleteMock).toHaveBeenCalledTimes(1)
    expect(issueUpdateMock).not.toHaveBeenCalled()
  })

  it('opened: TP-番号の自動紐づけ(linkIssueToTasks)を、書き換えた Issue の行IDで呼ぶ', async () => {
    const { handleIssueEvent } = await load()
    const payload = makeIssuePayload({ title: 'TP-42 のバグ', body: null })

    await handleIssueEvent(payload)

    expect(linkIssueToTasksMock).toHaveBeenCalledTimes(1)
    expect(linkIssueToTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      REPO_ROW_ID,
      ISSUE_ROW_ID,
      'TP-42 のバグ',
      null
    )
  })

  it('edited でも自動紐づけを行う', async () => {
    const { handleIssueEvent } = await load()
    await handleIssueEvent(makeIssuePayload({}, { action: 'edited' }))

    expect(linkIssueToTasksMock).toHaveBeenCalledTimes(1)
  })

  it('closed/reopened/assigned/unassigned では自動紐づけを行わない', async () => {
    const { handleIssueEvent } = await load()

    for (const action of ['closed', 'reopened', 'assigned', 'unassigned'] as const) {
      linkIssueToTasksMock.mockClear()
      await handleIssueEvent(makeIssuePayload({}, { action }))
      expect(linkIssueToTasksMock).not.toHaveBeenCalled()
    }
  })

  it('RPC の戻り値をタスクごとの結果としてそのまま返す', async () => {
    rpcData = [
      {
        task_id: 'task-1',
        open_count_before: 1,
        open_count_after: 0,
        completed_count_after: 1,
        not_planned_count_after: 0,
        all_closed_at_after: '2026-09-10T00:00:00.000Z',
        became_all_closed: true,
      },
      {
        task_id: 'task-2',
        open_count_before: 2,
        open_count_after: 1,
        completed_count_after: 1,
        not_planned_count_after: 0,
        all_closed_at_after: null,
        became_all_closed: false,
      },
    ]
    const { handleIssueEvent } = await load()

    const result = await handleIssueEvent(makeIssuePayload({ state: 'closed' }, { action: 'closed' }))

    expect(result.results).toEqual(rpcData)
  })

  it('became_all_closed かつ closed イベントのタスクだけを becameAllClosedByClose にまとめる（通知はしない）', async () => {
    rpcData = [
      {
        task_id: 'task-1',
        open_count_before: 1,
        open_count_after: 0,
        completed_count_after: 1,
        not_planned_count_after: 0,
        all_closed_at_after: '2026-09-10T00:00:00.000Z',
        became_all_closed: true,
      },
      {
        task_id: 'task-2',
        open_count_before: 0,
        open_count_after: 0,
        completed_count_after: 2,
        not_planned_count_after: 0,
        all_closed_at_after: '2026-09-01T00:00:00.000Z',
        became_all_closed: false,
      },
    ]
    const { handleIssueEvent } = await load()

    const closedResult = await handleIssueEvent(makeIssuePayload({ state: 'closed' }, { action: 'closed' }))
    expect(closedResult.becameAllClosedByClose).toEqual(['task-1'])

    // reopened で became_all_closed=true が返っても、原因は closed ではないので対象外
    rpcData = [{ ...rpcData[0] as object, became_all_closed: true }]
    const reopenedResult = await handleIssueEvent(makeIssuePayload({ state: 'open' }, { action: 'reopened' }))
    expect(reopenedResult.becameAllClosedByClose).toEqual([])
  })

  it('tasks 表には一切アクセスしない（opened / closed / deleted / transferred のすべてで）', async () => {
    const { handleIssueEvent } = await load()
    repoRowsByRepoId[2] = { id: 'repo-row-2' }

    await handleIssueEvent(makeIssuePayload({}, { action: 'opened' }))
    await handleIssueEvent(makeIssuePayload({}, { action: 'closed' }))
    await handleIssueEvent(makeIssuePayload({}, { action: 'deleted' }))
    await handleIssueEvent(
      makeIssuePayload(
        {},
        {
          action: 'transferred',
          changes: { new_repository: { id: 2, name: 'r2', full_name: 'yuta090/r2', owner: { login: 'yuta090' } } },
        }
      )
    )

    expect(tableAccessLog).not.toContain('tasks')
  })

  it('RPCが失敗したら success=false を返す', async () => {
    rpcError = { message: 'boom' }
    const { handleIssueEvent } = await load()

    const result = await handleIssueEvent(makeIssuePayload({}, { action: 'closed' }))

    expect(result.success).toBe(false)
  })
})

describe('selectTasksBecameAllClosedByIssueClose', () => {
  it('action が closed 以外なら空を返す', async () => {
    const { selectTasksBecameAllClosedByIssueClose } = await load()
    const rows = [
      {
        task_id: 't1',
        open_count_before: 1,
        open_count_after: 0,
        completed_count_after: 1,
        not_planned_count_after: 0,
        all_closed_at_after: null,
        became_all_closed: true,
      },
    ]

    expect(selectTasksBecameAllClosedByIssueClose('reopened', rows)).toEqual([])
  })

  it('closed かつ became_all_closed=true の task_id だけを返す', async () => {
    const { selectTasksBecameAllClosedByIssueClose } = await load()
    const rows = [
      {
        task_id: 't1',
        open_count_before: 1,
        open_count_after: 0,
        completed_count_after: 1,
        not_planned_count_after: 0,
        all_closed_at_after: null,
        became_all_closed: true,
      },
      {
        task_id: 't2',
        open_count_before: 0,
        open_count_after: 0,
        completed_count_after: 2,
        not_planned_count_after: 0,
        all_closed_at_after: null,
        became_all_closed: false,
      },
    ]

    expect(selectTasksBecameAllClosedByIssueClose('closed', rows)).toEqual(['t1'])
  })
})
