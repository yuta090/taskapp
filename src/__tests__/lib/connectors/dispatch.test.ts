import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/connectors/dispatch.ts — 汎用コネクタ送信ディスパッチャ。
 * connector_jobs を claim → 接続の provider(multica/google_tasks)ごとに配達 → 結果確定(done/backoff/dead)。
 */

const sendIssueUpsertMock = vi.fn()
const sendIssueCancelMock = vi.fn()
vi.mock('@/lib/connectors/multica/client', () => ({
  sendIssueUpsert: (...a: unknown[]) => sendIssueUpsertMock(...a),
  sendIssueCancel: (...a: unknown[]) => sendIssueCancelMock(...a),
}))

const patchTaskMock = vi.fn()
vi.mock('@/lib/google-tasks/client', () => ({
  patchTask: (...a: unknown[]) => patchTaskMock(...a),
}))

const getValidTokenDetailedMock = vi.fn()
vi.mock('@/lib/integrations/token-manager', () => ({
  getValidTokenDetailed: (...a: unknown[]) => getValidTokenDetailedMock(...a),
}))
vi.mock('@/lib/google-calendar/client', () => ({ refreshAccessToken: vi.fn() }))

// タスク同期アダプタ経由の完了書き戻し（Backlog等）
const completeTaskMock = vi.fn()
const getTaskSyncAdapterMock = vi.fn()
const resolveCredentialsMock = vi.fn()
vi.mock('@/lib/task-sync/adapters', () => ({
  getTaskSyncAdapter: (...a: unknown[]) => getTaskSyncAdapterMock(...a),
}))
vi.mock('@/lib/task-sync/credentials', () => ({
  resolveCredentials: (...a: unknown[]) => resolveCredentialsMock(...a),
}))

// --- supabase をモック ---
interface ConnRow {
  id: string
  provider: string
  metadata: Record<string, unknown> | null
  auth_kind?: string
  base_url?: string | null
  access_token_encrypted?: string | null
  import_config?: Record<string, unknown> | null
}
interface LinkRow {
  connection_id: string
  task_id: string
  external_id: string
  external_list_id: string | null
}

const rpcMock = vi.fn()
const state = {
  conns: [] as ConnRow[],
  links: [] as LinkRow[],
  upserts: [] as Array<{ table: string; value: unknown }>,
}

function makeChain(table: string) {
  let mode: 'select' | 'upsert' | null = null
  const eqFilters: Record<string, unknown> = {}
  let inFilter: { col: string; vals: unknown[] } | null = null

  function resolveNow(): { data: unknown; error: unknown } {
    if (table === 'integration_connections') {
      if (inFilter) {
        const rows = state.conns.filter((c) => inFilter!.vals.includes(c.id))
        return { data: rows, error: null }
      }
      return { data: state.conns, error: null }
    }
    if (table === 'connector_task_links') {
      const rows = state.links.filter((l) => {
        if (eqFilters.connection_id && l.connection_id !== eqFilters.connection_id) return false
        if (eqFilters.task_id && l.task_id !== eqFilters.task_id) return false
        return true
      })
      return { data: rows[0] ?? null, error: null }
    }
    return { data: null, error: null }
  }

  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: vi.fn(() => {
      if (!mode) mode = 'select'
      return chain
    }),
    upsert: vi.fn((v: unknown) => {
      mode = 'upsert'
      state.upserts.push({ table, value: v })
      return chain
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqFilters[col] = val
      return chain
    }),
    in: vi.fn((col: string, vals: unknown[]) => {
      inFilter = { col, vals }
      return chain
    }),
    maybeSingle: vi.fn(() => Promise.resolve(resolveNow())),
    then: (resolve: (v: unknown) => unknown) => resolve(resolveNow()),
  })
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: rpcMock, from: vi.fn((t: string) => makeChain(t)) })),
}))

const { dispatchConnectorJobsBatch } = await import('@/lib/connectors/dispatch')

function job(
  connectionId: string,
  op: 'upsert' | 'cancel' | 'complete',
  payload: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `job-${connectionId}-${op}`,
    connection_id: connectionId,
    task_id: 'task-1',
    op,
    payload,
    attempt: 0,
    version: 1,
    leased_until: null,
    ...overrides,
  }
}

function claimReturns(jobs: unknown[]) {
  rpcMock.mockImplementation((name: string) =>
    name === 'rpc_claim_connector_jobs'
      ? Promise.resolve({ data: jobs, error: null })
      : Promise.resolve({ data: null, error: null }),
  )
}

function completeCall(outcome: string) {
  return rpcMock.mock.calls.find(
    (c) => c[0] === 'rpc_complete_connector_job' && (c[1] as { p_outcome: string }).p_outcome === outcome,
  )
}

const MULTICA_CONN: ConnRow = {
  id: 'conn-multica',
  provider: 'multica',
  metadata: { multica: { base_url: 'https://multica.example.com', send_secret: 'sec' } },
}
const GTASKS_CONN: ConnRow = { id: 'conn-gtasks', provider: 'google_tasks', metadata: {} }
const BACKLOG_CONN: ConnRow = {
  id: 'conn-backlog',
  provider: 'backlog',
  metadata: {},
  auth_kind: 'api_key',
  base_url: 'https://e.backlog.jp',
  access_token_encrypted: 'enc',
  import_config: { backlog_completion_status_id: 12, trello_done_list_ids: ['x'] },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  state.conns = [MULTICA_CONN, GTASKS_CONN, BACKLOG_CONN]
  completeTaskMock.mockReset().mockResolvedValue(undefined)
  getTaskSyncAdapterMock.mockReset().mockImplementation((provider: string) =>
    provider === 'backlog' ? { id: 'backlog', completeTask: completeTaskMock } : null,
  )
  resolveCredentialsMock.mockReset().mockResolvedValue({
    status: 'ok',
    credentials: { kind: 'api_key', token: 'k', baseUrl: 'https://e.backlog.jp' },
  })
  state.links = []
  state.upserts = []
  getValidTokenDetailedMock.mockResolvedValue({ status: 'ok', token: 'access-token' })
  sendIssueUpsertMock.mockResolvedValue({ issueId: 'iss-1' })
  sendIssueCancelMock.mockResolvedValue(undefined)
  patchTaskMock.mockResolvedValue({ id: 'gt-1' })
})

describe('dispatchConnectorJobsBatch', () => {
  it('ジョブが無ければ何もしない', async () => {
    claimReturns([])
    const s = await dispatchConnectorJobsBatch()
    expect(s).toEqual({ claimed: 0, done: 0, tempFailed: 0, dead: 0 })
    expect(sendIssueUpsertMock).not.toHaveBeenCalled()
  })

  describe('provider=multica', () => {
    it('upsert成功 → connector_task_links(external_id=issue_id, origin=external)を保存しdone', async () => {
      claimReturns([job('conn-multica', 'upsert', { title: 'やること', status: 'todo' })])
      const s = await dispatchConnectorJobsBatch()

      expect(sendIssueUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conn-multica' }),
        expect.objectContaining({ taskRef: 'task-1', title: 'やること' }),
      )
      const linkUpsert = state.upserts.find((u) => u.table === 'connector_task_links')
      expect(linkUpsert).toBeTruthy()
      expect(linkUpsert?.value).toMatchObject({
        connection_id: 'conn-multica',
        task_id: 'task-1',
        external_id: 'iss-1',
        origin: 'external',
      })
      expect(completeCall('done')).toBeTruthy()
      expect(s.done).toBe(1)
    })

    it('cancel → sendIssueCancelを呼びdone', async () => {
      claimReturns([job('conn-multica', 'cancel')])
      const s = await dispatchConnectorJobsBatch()
      expect(sendIssueCancelMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-multica' }), 'task-1')
      expect(s.done).toBe(1)
    })

    it('base_url未設定(422)相当のエラー → permanent_fail=dead', async () => {
      sendIssueUpsertMock.mockRejectedValue(Object.assign(new Error('missing config'), { status: 422 }))
      claimReturns([job('conn-multica', 'upsert', { title: 'x' })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('permanent_fail')).toBeTruthy()
      expect(s.dead).toBe(1)
    })

    it('一時的なHTTP失敗(500) → temporary_fail でバックオフに回す', async () => {
      sendIssueUpsertMock.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }))
      claimReturns([job('conn-multica', 'upsert', { title: 'x' })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(s.tempFailed).toBe(1)
      expect(s.dead).toBe(0)
    })

    it('404(毒) → permanent_fail=dead', async () => {
      sendIssueUpsertMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      claimReturns([job('conn-multica', 'upsert', { title: 'x' })])
      const s = await dispatchConnectorJobsBatch()
      expect(s.dead).toBe(1)
    })
  })

  describe('provider=google_tasks', () => {
    it('op=complete → link から external_id/list_id を引き patchTask(status:completed) を呼ぶ', async () => {
      state.links = [
        { connection_id: 'conn-gtasks', task_id: 'task-1', external_id: 'gt-9', external_list_id: 'list-1' },
      ]
      claimReturns([job('conn-gtasks', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(patchTaskMock).toHaveBeenCalledWith('access-token', 'list-1', 'gt-9', { status: 'completed' })
      expect(s.done).toBe(1)
    })

    it('op=complete で gtasks 側が404(既に消えている) → done扱い(dead にしない)', async () => {
      state.links = [
        { connection_id: 'conn-gtasks', task_id: 'task-1', external_id: 'gt-9', external_list_id: 'list-1' },
      ]
      patchTaskMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      claimReturns([job('conn-gtasks', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(s.done).toBe(1)
      expect(s.dead).toBe(0)
    })

    it('op=complete でlinkが無い → 恒久失敗(dead)にする(書き戻し先不明)', async () => {
      state.links = []
      claimReturns([job('conn-gtasks', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(patchTaskMock).not.toHaveBeenCalled()
      expect(s.dead).toBe(1)
    })

    it('op=upsert/cancel は no-op で done(gtasksはTaskAppからの起票/更新を押し戻さない)', async () => {
      claimReturns([job('conn-gtasks', 'upsert', { title: 'x' })])
      const s = await dispatchConnectorJobsBatch()
      expect(patchTaskMock).not.toHaveBeenCalled()
      expect(s.done).toBe(1)
    })

    it('トークンが失効(auth_failed) → gtasksを叩かずtemporary_failで寝かせる', async () => {
      getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })
      claimReturns([job('conn-gtasks', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(patchTaskMock).not.toHaveBeenCalled()
      expect(s.tempFailed).toBe(1)
    })
  })

  /**
   * タスク同期アダプタを持つ provider の完了書き戻し。これが無いと、カタログが
   * completionWrite=true と宣言しているのにジョブが unsupported_provider で即 dead になり、
   * 「TaskAppで完了しても外部ツールに反映されない」片翼だけの同期になる。
   */
  describe('provider=タスク同期アダプタ(backlog)', () => {
    it('op=complete → アダプタの completeTask で外部へ書き戻す', async () => {
      state.links = [
        { connection_id: 'conn-backlog', task_id: 'task-1', external_id: '101', external_list_id: 'proj-1' },
      ]
      claimReturns([job('conn-backlog', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(completeTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ config: { backlog_completion_status_id: 12 } }),
        { externalId: '101', containerId: 'proj-1' },
      )
      expect(s.done).toBe(1)
    })

    it('外部側が既に消えている(404)なら done 扱い(完了と同義)', async () => {
      state.links = [
        { connection_id: 'conn-backlog', task_id: 'task-1', external_id: '101', external_list_id: 'proj-1' },
      ]
      completeTaskMock.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }))
      claimReturns([job('conn-backlog', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(s.done).toBe(1)
      expect(s.dead).toBe(0)
    })

    it('書き戻し先の対応が無ければ恒久失敗(再試行では解決しない)', async () => {
      state.links = []
      claimReturns([job('conn-backlog', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(completeTaskMock).not.toHaveBeenCalled()
      expect(s.dead).toBe(1)
    })

    it('資格情報の失効は毒にせず一時失敗(再接続すれば直る)', async () => {
      resolveCredentialsMock.mockResolvedValue({ status: 'auth_failed' })
      claimReturns([job('conn-backlog', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(completeTaskMock).not.toHaveBeenCalled()
      expect(s.tempFailed).toBe(1)
    })

    it('設定不備は恒久失敗(再試行では直らないものを永久に叩き続けない)', async () => {
      resolveCredentialsMock.mockResolvedValue({ status: 'misconfigured', reason: 'x' })
      claimReturns([job('conn-backlog', 'complete')])
      const s = await dispatchConnectorJobsBatch()
      expect(s.dead).toBe(1)
    })

    it('op=upsert/cancel は押し戻さず done(取り込み専用の契約)', async () => {
      claimReturns([job('conn-backlog', 'upsert', { title: 'x' })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeTaskMock).not.toHaveBeenCalled()
      expect(s.done).toBe(1)
    })
  })

  it('未対応providerの接続はpermanent_fail=deadにする', async () => {
    state.conns = [{ id: 'conn-unknown', provider: 'notion', metadata: {} }]
    claimReturns([job('conn-unknown', 'upsert', {})])
    const s = await dispatchConnectorJobsBatch()
    expect(s.dead).toBe(1)
  })

  it('接続が見つからない(削除済み) → permanent_fail=dead', async () => {
    state.conns = []
    claimReturns([job('conn-gone', 'upsert', {})])
    const s = await dispatchConnectorJobsBatch()
    expect(s.dead).toBe(1)
  })

  it('lease切れの行は処理せずスキップする(completeを呼ばない)', async () => {
    claimReturns([job('conn-multica', 'upsert', { title: 'x' }, { leased_until: '2000-01-01T00:00:00.000Z' })])
    const s = await dispatchConnectorJobsBatch()
    expect(sendIssueUpsertMock).not.toHaveBeenCalled()
    expect(rpcMock.mock.calls.find((c) => c[0] === 'rpc_complete_connector_job')).toBeUndefined()
    expect(s.done).toBe(0)
  })

  it('complete RPCにjob.versionを渡す(処理中foldをRPC側で弾けるように)', async () => {
    claimReturns([job('conn-multica', 'upsert', { title: 'x' }, { version: 7 })])
    await dispatchConnectorJobsBatch()
    const done = completeCall('done')
    expect((done?.[1] as { p_version: number }).p_version).toBe(7)
  })
})
