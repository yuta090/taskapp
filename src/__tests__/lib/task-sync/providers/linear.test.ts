import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { linearAdapter } from '@/lib/task-sync/providers/linear'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Linear アダプタ。
 *
 * 調査で確定した事実（出典と確認方法。すべて Linear が公開しているGraphQLスキーマ
 * https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql
 * ＝公式SDKに同梱された実APIから自動生成されたスキーマ定義。2026-07-21取得）:
 *   - APIは単一エンドポイント `https://api.linear.app/graphql`。実際に匿名/不正キーで叩くと
 *     GraphQLの「200+errors」ではなく素の **HTTP 401** が返ることを確認済み
 *     （`extensions.http.status` にも同じ値が載る）。認証エラーは res.ok=false で拾える。
 *   - 認証ヘッダは個人APIキーの場合 `Authorization: <key>`（**Bearer接頭辞なし**）。
 *     OAuthアクセストークンの場合のみ `Bearer` が付く。公式SDK本体のソース
 *     (`packages/sdk/src/client.ts`)で確認。
 *   - 完了判定は `state.type === 'completed'`。`canceled` は別語彙として独立しており
 *     （schema: `WorkflowState.type` は "triage"/"backlog"/"unstarted"/"started"/"completed"/
 *     "canceled"/"duplicate" の固定語彙）、完了とは別物として扱う。
 *   - 期日は `dueDate`（スカラー `TimelessDate`）。担当者は `assignee.id`。
 *   - 取り込み単位は **team**（`project` ではない）。`Issue.team: Team!` は必須(NOT NULL)だが
 *     `Issue.project: Project` は任意(NULL可)＝全Issueに必ず存在する入れ物はteamのみ。
 *     完了状態のIDもteam単位（`Team.states`）管理のため、containerId=team.idにする。
 *   - ページングは `IssueConnection { edges, nodes, pageInfo }` /
 *     `PageInfo { hasNextPage, endCursor }`（cursorベース）。
 *   - 差分は `IssueFilter.updatedAt: DateComparator` の `gt` で絞る。team絞り込みは
 *     `IssueFilter.team.id.eq`。
 *   - 完了の書き戻しは `issueUpdate(id, input: { stateId })`。`stateId` はteamごとに異なるため
 *     実行時に `team(id).states(filter: { type: { eq: "completed" } })` を引いて解決する。
 *   - 削除の検知: `Issue.trashed: Boolean` が存在する。ただし `issues` クエリは既定で
 *     `includeArchived: false` のため、`includeArchived: true` を明示して差分に含め、
 *     `trashed` を tombstone として使う。
 */

const ENDPOINT = 'https://api.linear.app/graphql'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'api_key', token: 'lin_api_secretkey', baseUrl: null }, config }
}

function graphqlResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
    text: async () => JSON.stringify({ data }),
  } as Response
}

function unauthenticatedResponse(status: number, message = 'boom'): Response {
  const body = { errors: [{ message, extensions: { http: { status } } }] }
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall(): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return call as [string, RequestInit | undefined]
}

function lastBody(): Record<string, unknown> {
  const [, init] = lastCall()
  return JSON.parse(String(init?.body))
}

describe('linearAdapter — 宣言', () => {
  it('APIキー認証・固定ホストポリシー・差分はタイムスタンプ粒度', () => {
    expect(linearAdapter.id).toBe('linear')
    expect(linearAdapter.authKind).toBe('api_key')
    expect(linearAdapter.hostPolicy).toEqual({ kind: 'fixed', host: 'api.linear.app' })
    expect(linearAdapter.cursorGranularity).toBe('timestamp')
    // Issue.trashed をtombstoneとして使える。
    expect(linearAdapter.deletionMode).toBe('tombstone')
  })
})

describe('linearAdapter — 認証', () => {
  it('APIキーをBearer接頭辞なしでAuthorizationヘッダに送る', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({ teams: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }),
    )
    await linearAdapter.listContainers(ctx())
    const [url, init] = lastCall()
    expect(url).toBe(ENDPOINT)
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('lin_api_secretkey')
  })

  it('リダイレクトを自動追跡しない', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({ teams: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }),
    )
    await linearAdapter.listContainers(ctx())
    expect(lastCall()[1]?.redirect).toBe('manual')
  })

  it('例外メッセージにAPIキーを含めない', async () => {
    fetchMock.mockResolvedValueOnce(unauthenticatedResponse(500))
    const err = await linearAdapter.listContainers(ctx()).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('lin_api_secretkey')
  })
})

describe('linearAdapter.listContainers', () => {
  it('チーム一覧を id/title に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        teams: {
          nodes: [
            { id: 'team-1', name: 'エンジニアリング', key: 'ENG' },
            { id: 'team-2', name: 'デザイン', key: 'DES' },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    )
    const containers = await linearAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: 'team-1', title: 'エンジニアリング' },
      { id: 'team-2', title: 'デザイン' },
    ])
  })

  it('hasNextPageの間はafterカーソルを進めてページングする', async () => {
    fetchMock
      .mockResolvedValueOnce(
        graphqlResponse({
          teams: {
            nodes: [{ id: 'team-1', name: 'チーム1' }],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
          },
        }),
      )
      .mockResolvedValueOnce(
        graphqlResponse({
          teams: {
            nodes: [{ id: 'team-2', name: 'チーム2' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        }),
      )
    const containers = await linearAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: 'team-1', title: 'チーム1' },
      { id: 'team-2', title: 'チーム2' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lastBody().variables).toMatchObject({ after: 'cursor-1' })
  })
})

describe('linearAdapter.listChangedTasks', () => {
  const node = {
    id: 'issue-1',
    title: '契約書のドラフト',
    description: '初稿を作る',
    dueDate: '2026-07-31',
    state: { type: 'started', name: 'In Progress' },
    assignee: { id: 'user-55' },
    updatedAt: '2026-07-20T10:00:00.000Z',
    trashed: false,
  }

  it('Issueを ExternalTask に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        issues: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } },
      }),
    )
    const page = await linearAdapter.listChangedTasks(ctx(), 'team-1', {})
    expect(page.items).toEqual([
      {
        externalId: 'issue-1',
        containerId: 'team-1',
        title: '契約書のドラフト',
        body: '初稿を作る',
        dueDate: '2026-07-31',
        completed: false,
        deleted: false,
        assigneeKey: 'user-55',
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    ])
  })

  it('期日・本文・担当が無いIssueも落とさず null に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        issues: {
          nodes: [{ id: 'issue-2', title: '電話する', state: { type: 'unstarted' } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    )
    const page = await linearAdapter.listChangedTasks(ctx(), 'team-1', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null, completed: false })
  })

  it('state.type=completed を completed=true と判定する', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        issues: {
          nodes: [{ ...node, id: 'issue-3', state: { type: 'completed', name: 'カスタム完了名' } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    )
    const page = await linearAdapter.listChangedTasks(ctx(), 'team-1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('state.type=canceled は completed=false のまま扱う（完了とは別物）', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        issues: {
          nodes: [{ ...node, id: 'issue-4', state: { type: 'canceled' } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    )
    const page = await linearAdapter.listChangedTasks(ctx(), 'team-1', {})
    expect(page.items[0].completed).toBe(false)
  })

  it('trashed:true を deleted=true として伝える', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        issues: {
          nodes: [{ ...node, id: 'issue-5', trashed: true }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    )
    const page = await linearAdapter.listChangedTasks(ctx(), 'team-1', {})
    expect(page.items[0].deleted).toBe(true)
  })

  it('teamでのフィルタとsinceのupdatedAt絞り込みをGraphQL変数に載せ、includeArchivedを明示する', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({ issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }),
    )
    await linearAdapter.listChangedTasks(ctx(), 'team-1', { since: '2026-07-19T00:00:00.000Z' })
    const body = lastBody()
    expect(body.variables).toMatchObject({
      filter: { team: { id: { eq: 'team-1' } }, updatedAt: { gt: '2026-07-19T00:00:00.000Z' } },
    })
    // trashed済みIssueも差分に含めるため includeArchived:true をクエリ本体に埋め込んでいる。
    expect(String(body.query)).toContain('includeArchived: true')
  })

  it('cursorをafterに渡し、pageInfoのendCursorをnextCursorにする', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next-cursor' } },
      }),
    )
    const page = await linearAdapter.listChangedTasks(ctx(), 'team-1', { cursor: 'prev-cursor' })
    expect(lastBody().variables).toMatchObject({ after: 'prev-cursor' })
    expect(page.nextCursor).toBe('next-cursor')
  })

  it('hasNextPage=falseならnextCursorはnullで打ち切る', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({
        issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: 'ignored' } },
      }),
    )
    const page = await linearAdapter.listChangedTasks(ctx(), 'team-1', {})
    expect(page.nextCursor).toBeNull()
  })

  it('HTTPレベルのエラー(認証失敗等)はstatusを載せた例外にする', async () => {
    fetchMock.mockResolvedValueOnce(unauthenticatedResponse(401, 'Authentication required'))
    await expect(linearAdapter.listChangedTasks(ctx(), 'team-1', {})).rejects.toMatchObject({ status: 401 })
  })

  it('200+GraphQLエラーも extensions.http.status を拾って例外にする', async () => {
    // res.ok=true(HTTP 200)のまま body に errors が積まれるケース(GraphQLのバリデーションエラー等)を模擬。
    const res = {
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'invalid filter', extensions: { http: { status: 400 } } }] }),
      text: async () => '',
    } as Response
    fetchMock.mockResolvedValueOnce(res)
    await expect(linearAdapter.listChangedTasks(ctx(), 'team-1', {})).rejects.toMatchObject({ status: 400 })
  })

  it('429 は Retry-After(秒) を retryAfterMs として載せる', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '15' }),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const err = await linearAdapter.listChangedTasks(ctx(), 'team-1', {}).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(15_000)
  })

  it('Retry-Afterが無い429は requests/complexity の reset(Unix秒)のうち遅い方を使う', async () => {
    const now = Math.floor(Date.now() / 1000)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      // complexity側の方が回復が遅い(=まだ制限中)ケース。早い方(requests)だけ見て
      // 即再試行すると、まだ制限中のcomplexity側で再び429を食らってしまう。
      headers: new Headers({
        'X-RateLimit-Requests-Reset': String(now + 10),
        'X-RateLimit-Complexity-Reset': String(now + 120),
      }),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const err = await linearAdapter.listChangedTasks(ctx(), 'team-1', {}).catch((e) => e)
    expect(err.retryAfterMs).toBeGreaterThan(100_000)
    expect(err.retryAfterMs).toBeLessThanOrEqual(120_000)
  })
})

describe('linearAdapter.completeTask', () => {
  it('teamのcompleted状態IDを解決してissueUpdateに渡す', async () => {
    fetchMock
      .mockResolvedValueOnce(
        graphqlResponse({
          team: {
            states: {
              nodes: [
                { id: 'state-started', type: 'started' },
                { id: 'state-done', type: 'completed' },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(graphqlResponse({ issueUpdate: { success: true } }))

    await linearAdapter.completeTask(ctx(), { externalId: 'issue-1', containerId: 'team-1' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = lastBody()
    expect(secondBody.variables).toMatchObject({ id: 'issue-1', input: { stateId: 'state-done' } })
  })

  it('teamにcompleted状態が無い場合は解決不能として例外にする', async () => {
    fetchMock.mockResolvedValueOnce(
      graphqlResponse({ team: { states: { nodes: [{ id: 'state-a', type: 'started' }] } } }),
    )
    await expect(
      linearAdapter.completeTask(ctx(), { externalId: 'issue-1', containerId: 'team-1' }),
    ).rejects.toThrow(/completed/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('issueUpdateがsuccess:falseを返したら例外にする', async () => {
    fetchMock
      .mockResolvedValueOnce(
        graphqlResponse({ team: { states: { nodes: [{ id: 'state-done', type: 'completed' }] } } }),
      )
      .mockResolvedValueOnce(graphqlResponse({ issueUpdate: { success: false } }))
    await expect(
      linearAdapter.completeTask(ctx(), { externalId: 'issue-1', containerId: 'team-1' }),
    ).rejects.toThrow()
  })
})
