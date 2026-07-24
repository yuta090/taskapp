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
  // 自分側DBの瞬断を撃ち分けるフラグ(接続行 read / 対応表 read)。
  connError: false,
  linkError: false,
  // 接続行 read の select 自体が reject(通信断で throw)する経路を模す(loadConnections の try/catch 検証)。
  connThrow: false,
}

function makeChain(table: string) {
  let mode: 'select' | 'upsert' | null = null
  const eqFilters: Record<string, unknown> = {}
  let inFilter: { col: string; vals: unknown[] } | null = null

  function resolveNow(): { data: unknown; error: unknown } {
    if (table === 'integration_connections') {
      // 接続行 read の select が reject(通信断で throw)する経路を模す(loadConnections の try/catch 検証)。
      if (state.connThrow) throw new Error('integration_connections network down')
      // 接続行 read の DB 瞬断を模す(loadConnections が throw せず dbError を返す経路)。
      if (state.connError) return { data: null, error: { message: 'integration_connections db down' } }
      if (inFilter) {
        const rows = state.conns.filter((c) => inFilter!.vals.includes(c.id))
        return { data: rows, error: null }
      }
      return { data: state.conns, error: null }
    }
    if (table === 'connector_task_links') {
      // 対応表 read の DB 瞬断を模す(ただし upsert=saveMulticaLink には出さない)。
      if (state.linkError && mode !== 'upsert') {
        return { data: null, error: { message: 'connector_task_links db down' } }
      }
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
// infraTransient は mock しない(実ヘルパーを使って multica クライアントの infra 一時障害を模す)。
const { infraTransientError } = await import('@/lib/connectors/infraTransient')

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
  state.connError = false
  state.linkError = false
  state.connThrow = false
  getValidTokenDetailedMock.mockResolvedValue({ status: 'ok', token: 'access-token' })
  sendIssueUpsertMock.mockResolvedValue({ issueId: 'iss-1' })
  sendIssueCancelMock.mockResolvedValue(undefined)
  patchTaskMock.mockResolvedValue({ id: 'gt-1' })
})

describe('dispatchConnectorJobsBatch', () => {
  it('ジョブが無ければ何もしない', async () => {
    claimReturns([])
    const s = await dispatchConnectorJobsBatch()
    expect(s).toEqual({ claimed: 0, done: 0, tempFailed: 0, dead: 0, deferred: 0 })
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

    /**
     * classifyError は明示された ProviderError.permanent を最優先する(status だけで判定しない)。
     * kintone の GAIA_NO01(権限不足=恒久。status=403)/GAIA_UN03(同時編集競合=一時。status=409)の
     * ような「status だけでは意図した分類にならない」ケースを固定する回帰テスト。
     */
    describe('classifyError は permanent(明示)を status より優先する', () => {
      beforeEach(() => {
        // これらのテストは completeTask 自体の失敗分類を見たいので、書き戻し先の対応は
        // 揃っている前提にする(対応が無い恒久失敗の分岐に化けないように)。
        state.links = [
          { connection_id: 'conn-backlog', task_id: 'task-1', external_id: '101', external_list_id: 'proj-1' },
        ]
      })

      it('permanent:true が明示されていれば、status が恒久失敗の判定リストに無くても dead にする', async () => {
        completeTaskMock.mockRejectedValue(
          Object.assign(new Error('insufficient permission'), { status: 403, permanent: true }),
        )
        claimReturns([job('conn-backlog', 'complete')])
        const s = await dispatchConnectorJobsBatch()
        expect(s.dead).toBe(1)
        expect(s.tempFailed).toBe(0)
      })

      it('permanent:false が明示されていれば、status が恒久失敗の判定リストに含まれても一時失敗にする', async () => {
        completeTaskMock.mockRejectedValue(
          Object.assign(new Error('bad request but retryable'), { status: 400, permanent: false }),
        )
        claimReturns([job('conn-backlog', 'complete')])
        const s = await dispatchConnectorJobsBatch()
        expect(s.tempFailed).toBe(1)
        expect(s.dead).toBe(0)
      })

      it('permanent が未指定なら従来通り status フォールバックで判定する(既存挙動を維持)', async () => {
        completeTaskMock.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }))
        claimReturns([job('conn-backlog', 'complete')])
        const s = await dispatchConnectorJobsBatch()
        expect(s.dead).toBe(1)
      })
    })
  })

  /**
   * defer 強化(Fable 裁定 2026-07-23): 配達を試みる前の**自分側インフラ**一時障害(トークン復号RPC/
   * DB read の瞬断=transientKind 不在)は attempt を消費せず defer(5分後再試行)。attempt 不変そのものは
   * RPC(rpc_complete_connector_job の defer 分岐)が保証する。ここでは dispatch が outcome:'defer' を
   * 要求すること・72h キャップで temporary_fail へ降格すること・外部起因は従来どおり temporary_fail を固定する。
   */
  describe('インフラ一時障害の defer と 72h キャップ', () => {
    const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h前
    const staleCreatedAt = () => new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString() // 73h前

    it('google_tasks: インフラ一時障害(transient_error, kind無し)は attempt を消費せず defer', async () => {
      getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('defer')).toBeTruthy()
      expect(completeCall('temporary_fail')).toBeFalsy()
      expect(patchTaskMock).not.toHaveBeenCalled()
      expect(s.deferred).toBe(1)
      expect(s.tempFailed).toBe(0)
      expect(s.dead).toBe(0)
    })

    it('google_tasks: 外部refresh起因(transientKind=refresh)は defer せず従来どおり temporary_fail', async () => {
      getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error', transientKind: 'refresh' })
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
      expect(s.deferred).toBe(0)
    })

    it('google_tasks: created_at から72h超のインフラ一時障害は temporary_fail に降格(=最終的にdeadへ収束・無限defer防止)', async () => {
      getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: staleCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
      expect(s.deferred).toBe(0)
    })

    it('backlog(task-sync): 資格情報のインフラ一時障害(transient_error, kind無し)は defer', async () => {
      resolveCredentialsMock.mockResolvedValue({ status: 'transient_error' })
      claimReturns([job('conn-backlog', 'complete', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('defer')).toBeTruthy()
      expect(completeTaskMock).not.toHaveBeenCalled()
      expect(s.deferred).toBe(1)
      expect(s.tempFailed).toBe(0)
    })

    it('backlog(task-sync): 72h超のインフラ一時障害は temporary_fail に降格', async () => {
      resolveCredentialsMock.mockResolvedValue({ status: 'transient_error' })
      claimReturns([job('conn-backlog', 'complete', {}, { created_at: staleCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
      expect(s.deferred).toBe(0)
    })

    it('backlog(task-sync): 外部refresh起因(transientKind=refresh)は defer せず temporary_fail', async () => {
      resolveCredentialsMock.mockResolvedValue({ status: 'transient_error', transientKind: 'refresh' })
      claimReturns([job('conn-backlog', 'complete', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
      expect(s.deferred).toBe(0)
    })

    it('created_at が無い異常時は defer せず temporary_fail(安全側=寝かせ続けない)', async () => {
      getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
      claimReturns([job('conn-gtasks', 'complete', {})]) // created_at 未設定
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
    })

    it('created_at が未来(たった今 enqueue・クロックスキュー)は「若いジョブ」として defer', async () => {
      getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
      const future = new Date(Date.now() + 60 * 1000).toISOString()
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: future })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('defer')).toBeTruthy()
      expect(s.deferred).toBe(1)
      expect(s.tempFailed).toBe(0)
    })

    it('created_at がクロックスキュー超(5分超)の未来なら temporary_fail(無期限 defer にしない)', async () => {
      // 大きく未来の created_at は now-created<0 が永遠に 72h キャップに掛からず無期限 defer になり得る。
      // 5分の許容スキューを超える未来は不正値として temporary_fail に倒す(予算消費→最終 dead 収束)。
      getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
      const farFuture = new Date(Date.now() + 6 * 60 * 1000).toISOString() // 6分先
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: farFuture })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
      expect(s.deferred).toBe(0)
    })

    it('数十秒の軽微なクロックスキュー(未来)は従来どおり defer', async () => {
      getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
      const slightFuture = new Date(Date.now() + 30 * 1000).toISOString() // 30秒先
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: slightFuture })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('defer')).toBeTruthy()
      expect(completeCall('temporary_fail')).toBeFalsy()
      expect(s.deferred).toBe(1)
      expect(s.tempFailed).toBe(0)
    })

    it('created_at がちょうど72h(境界)は defer(> MAX で初めて降格)', async () => {
      // 境界の厳密検証には時刻の固定が要る。固定しないと「テストが created_at を作った時刻」と
      // 「実装が age=now-created を測る時刻(dispatch 内部の Date.now())」の間に数ミリ秒経過し、
      // age=72h+ε>MAX となって temporary_fail に転ぶ(ローカルは速く 0ms で通るが CI で断続失敗する
      // フレーキー)。両者を同一 now に固定すれば age===MAX ちょうど → `> MAX` は偽 → defer が決定的。
      const nowMs = new Date('2026-07-24T00:00:00.000Z').getTime()
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs)
      try {
        getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
        const exactly72h = new Date(nowMs - 72 * 60 * 60 * 1000).toISOString()
        claimReturns([job('conn-gtasks', 'complete', {}, { created_at: exactly72h })])
        const s = await dispatchConnectorJobsBatch()
        expect(completeCall('defer')).toBeTruthy()
        expect(completeCall('temporary_fail')).toBeFalsy()
        expect(s.deferred).toBe(1)
      } finally {
        nowSpy.mockRestore()
      }
    })
  })

  /**
   * Codex 指摘 Critical1: loadConnections のバッチ DB read 失敗。以前は throw してバッチ全体を中断し、
   * claim(lease)済みジョブが completion RPC を通らず lease 失効で無限に再 claim され、attempt が進まず
   * 72h キャップも迂回された。DB error は throw せず、claim 済み全ジョブを infra 一時障害として
   * completion に通す(72h 以内 defer / 超過 temporary_fail)。「row 不在(削除済み)」は別で permanent_fail。
   */
  describe('loadConnections の DB read 失敗(バッチを落とさず infra→defer)', () => {
    const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const staleCreatedAt = () => new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString()

    it('接続行 read が DB error のとき、throw せず claim 済み全ジョブを defer にする(無限再claim しない)', async () => {
      state.connError = true
      claimReturns([
        job('conn-multica', 'upsert', { title: 'x' }, { created_at: recentCreatedAt() }),
        job('conn-gtasks', 'complete', {}, { created_at: recentCreatedAt() }),
      ])
      // throw しないこと(バッチが最後まで走り summary を返す)を担保する。
      const s = await dispatchConnectorJobsBatch()
      expect(s.deferred).toBe(2)
      expect(s.dead).toBe(0)
      expect(s.tempFailed).toBe(0)
      // 全ジョブが completion(defer)を通っている=lease 失効での無限再claim を起こさない。
      const deferCalls = rpcMock.mock.calls.filter(
        (c) => c[0] === 'rpc_complete_connector_job' && (c[1] as { p_outcome: string }).p_outcome === 'defer',
      )
      expect(deferCalls).toHaveLength(2)
      // 外部送信は一切試みない(接続行が読めていない)。
      expect(sendIssueUpsertMock).not.toHaveBeenCalled()
      expect(patchTaskMock).not.toHaveBeenCalled()
    })

    it('接続行 read が DB error かつ 72h 超のジョブは temporary_fail に降格(無限 defer 防止)', async () => {
      state.connError = true
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: staleCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
      expect(s.deferred).toBe(0)
    })

    it('loadConnections 成功で該当 row が無い(削除済み)ジョブは従来どおり permanent_fail(connection_not_found)', async () => {
      // connError=false・row 不在 → DB error とは別物として恒久失敗。
      state.conns = []
      claimReturns([job('conn-gone', 'upsert', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      const permCall = completeCall('permanent_fail')
      expect(permCall).toBeTruthy()
      expect((permCall?.[1] as { p_error: string }).p_error).toBe('connection_not_found')
      expect(s.dead).toBe(1)
      expect(s.deferred).toBe(0)
    })
  })

  /**
   * Codex 指摘 Critical(本物): loadConnections の select が **reject(通信断で throw)** した場合。以前は
   * .error は拾って dbError を返すが reject は素通しで例外が伝播し、この呼び出しは per-connection の
   * try/catch の**外**にあるためバッチ全体が abort → claim 済み全ジョブが orphan(completion を通らず
   * lease 失効 → 無限再 claim)になった。select を try/catch で囲み、reject も .error と同じく dbError=true に
   * 倒す(=claim 済み全ジョブを infra defer に通す)。
   */
  describe('loadConnections の select が reject(throw)してもバッチを落とさず defer にする', () => {
    const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const staleCreatedAt = () => new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString()

    it('select が reject(通信断で throw)しても throw せず claim 済み全ジョブを defer にする', async () => {
      state.connThrow = true
      claimReturns([
        job('conn-multica', 'upsert', { title: 'x' }, { created_at: recentCreatedAt() }),
        job('conn-gtasks', 'complete', {}, { created_at: recentCreatedAt() }),
      ])
      // バッチが throw せず最後まで走り summary を返す(=abort しない)。
      const s = await dispatchConnectorJobsBatch()
      expect(s.deferred).toBe(2)
      expect(s.dead).toBe(0)
      expect(s.tempFailed).toBe(0)
      const deferCalls = rpcMock.mock.calls.filter(
        (c) => c[0] === 'rpc_complete_connector_job' && (c[1] as { p_outcome: string }).p_outcome === 'defer',
      )
      expect(deferCalls).toHaveLength(2)
      // 接続行が読めていない以上、外部送信は一切試みない。
      expect(sendIssueUpsertMock).not.toHaveBeenCalled()
      expect(patchTaskMock).not.toHaveBeenCalled()
    })

    it('select が reject かつ 72h 超のジョブは temporary_fail に降格(無限 defer 防止)', async () => {
      state.connThrow = true
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: staleCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('temporary_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.tempFailed).toBe(1)
      expect(s.deferred).toBe(0)
    })
  })

  /**
   * Codex 指摘 Critical1(不変条件): connLoadError / not-found 分岐の completeJob が瞬断で throw しても、
   * per-connection の try/catch 境界に入っているためバッチ全体が abort せず、他接続の claim 済みジョブは
   * completion を通る(orphan にしない)。completion RPC 自体が続けて落ちる接続のジョブだけ lease 失効に委ねる。
   */
  describe('completion RPC 瞬断でも per-connection 境界でバッチを落とさない(不変条件)', () => {
    const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()

    // 指定 job_id の rpc_complete_connector_job だけ error を返す(completion RPC 瞬断を模す)。
    function claimReturnsWithCompleteError(jobs: unknown[], failJobId: string) {
      rpcMock.mockImplementation((name: string, args?: unknown) => {
        if (name === 'rpc_claim_connector_jobs') return Promise.resolve({ data: jobs, error: null })
        if (name === 'rpc_complete_connector_job' && (args as { p_job_id: string }).p_job_id === failJobId) {
          return Promise.resolve({ data: null, error: { message: 'completion rpc down' } })
        }
        return Promise.resolve({ data: null, error: null })
      })
    }

    it('connLoadError 分岐で completeJob が throw しても他接続は defer される', async () => {
      state.connError = true
      const jobs = [
        job('conn-a', 'upsert', { title: 'x' }, { created_at: recentCreatedAt() }),
        job('conn-b', 'upsert', { title: 'y' }, { created_at: recentCreatedAt() }),
      ]
      claimReturnsWithCompleteError(jobs, 'job-conn-a-upsert')
      // throw せずに完走すること(バッチが abort しない)。
      const s = await dispatchConnectorJobsBatch()
      // conn-b の defer completion は通っている(他接続を巻き込まない)。
      const deferB = rpcMock.mock.calls.find(
        (c) =>
          c[0] === 'rpc_complete_connector_job' &&
          (c[1] as { p_job_id: string }).p_job_id === 'job-conn-b-upsert' &&
          (c[1] as { p_outcome: string }).p_outcome === 'defer',
      )
      expect(deferB).toBeTruthy()
      expect(s.deferred).toBe(1)
    })

    it('not-found 分岐で completeJob が throw しても他接続(multica)は done まで処理される', async () => {
      // conn-gone は不在(=not-found 分岐)、conn-multica は存在。
      state.conns = [MULTICA_CONN]
      const jobs = [
        job('conn-gone', 'upsert', {}, { created_at: recentCreatedAt() }),
        job('conn-multica', 'upsert', { title: 'x' }, { created_at: recentCreatedAt() }),
      ]
      claimReturnsWithCompleteError(jobs, 'job-conn-gone-upsert')
      const s = await dispatchConnectorJobsBatch()
      // multica は完走して done。not-found 側の completion 瞬断に巻き込まれない。
      expect(sendIssueUpsertMock).toHaveBeenCalled()
      expect(s.done).toBe(1)
    })
  })

  /**
   * Codex 指摘 Important: processConnectionJobs が同一接続の一部ジョブを完了させてから throw した場合、
   * 外側 catch が**完了済みジョブまで**もう一度 completeJob(defer)を呼び summary を二重計上していた。
   * completeJob 成立分を completedIds に記録し、外側 catch は未完了のジョブだけを救済 defer する。
   */
  describe('一部完了後に throw しても完了済みは再completionされない(summary が正確)', () => {
    const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()

    it('gtasks: 1件目 temporary_fail 確定後に2件目の completion が瞬断 throw → 1件目は再確定されず summary 正確', async () => {
      // auth_failed 経路(inner try/catch 無し)で completeJob の throw を外側 catch まで素通しさせる。
      getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })
      const j1 = job('conn-gtasks', 'complete', {}, { id: 'gt-j1', created_at: recentCreatedAt() })
      const j2 = job('conn-gtasks', 'complete', {}, { id: 'gt-j2', created_at: recentCreatedAt() })
      rpcMock.mockImplementation((name: string, args?: Record<string, unknown>) => {
        if (name === 'rpc_claim_connector_jobs') return Promise.resolve({ data: [j1, j2], error: null })
        if (name === 'rpc_complete_connector_job') {
          const a = args as { p_job_id: string; p_outcome: string }
          // gt-j2 の最初の completion(temporary_fail)だけ瞬断させる。外側 catch の defer(救済)は通す。
          if (a.p_job_id === 'gt-j2' && a.p_outcome === 'temporary_fail') {
            return Promise.resolve({ data: null, error: { message: 'completion rpc down' } })
          }
        }
        return Promise.resolve({ data: null, error: null })
      })
      const s = await dispatchConnectorJobsBatch()
      // 完了済み(gt-j1)は再 completion されない: completion 呼び出しはちょうど1回(temporary_fail)。
      const j1Calls = rpcMock.mock.calls.filter(
        (c) => c[0] === 'rpc_complete_connector_job' && (c[1] as { p_job_id: string }).p_job_id === 'gt-j1',
      )
      expect(j1Calls).toHaveLength(1)
      expect((j1Calls[0][1] as { p_outcome: string }).p_outcome).toBe('temporary_fail')
      // gt-j2 は最初の temporary_fail が瞬断 → 外側 catch で defer 救済される。
      // summary は実際に確定した結果と一致する(gt-j1 を二重計上しない)。
      expect(s).toMatchObject({ done: 0, tempFailed: 1, dead: 0, deferred: 1 })
    })
  })

  /**
   * Codex 指摘 Critical2: multica の send_secret 復号一時障害が恒久破損と区別されず即 permanent_fail/dead。
   * multica クライアントは復号一時障害を infraTransient マーカー付きで投げる(client.test.ts で担保)。
   * dispatch はそのマーカーを見て defer(72h キャップ)に回す。恒久破損(422)は従来どおり permanent。
   */
  describe('multica: 復号一時障害は defer / 恒久破損(422)は permanent', () => {
    const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()

    it('send_secret 復号一時障害(infraTransient マーカー)は attempt を消費せず defer', async () => {
      sendIssueUpsertMock.mockRejectedValue(infraTransientError('send_secret decrypt transient failure'))
      claimReturns([job('conn-multica', 'upsert', { title: 'x' }, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('defer')).toBeTruthy()
      expect(completeCall('permanent_fail')).toBeFalsy()
      expect(s.deferred).toBe(1)
      expect(s.dead).toBe(0)
    })

    it('send_secret 恒久破損(422)は従来どおり permanent_fail=dead(defer に流さない)', async () => {
      sendIssueUpsertMock.mockRejectedValue(Object.assign(new Error('corrupt'), { status: 422 }))
      claimReturns([job('conn-multica', 'upsert', { title: 'x' }, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('permanent_fail')).toBeTruthy()
      expect(completeCall('defer')).toBeFalsy()
      expect(s.dead).toBe(1)
      expect(s.deferred).toBe(0)
    })
  })

  /**
   * Codex 指摘 Important1: connector_task_links(対応表)read の DB 瞬断=外部送信より前の自分側障害。
   * 以前は temporary_fail(予算消費→最終 dead)だった。infra→defer に揃える。row 不在(書き戻し先未設定)は
   * 従来どおり permanent(別分岐)であり、これを defer に流さないことも固定する。
   */
  describe('link read(対応表)の DB 瞬断は infra→defer', () => {
    const recentCreatedAt = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()

    it('google_tasks: link read が DB error なら defer(dead にしない・外部を叩かない)', async () => {
      state.linkError = true
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('defer')).toBeTruthy()
      expect(patchTaskMock).not.toHaveBeenCalled()
      expect(s.deferred).toBe(1)
      expect(s.dead).toBe(0)
      expect(s.tempFailed).toBe(0)
    })

    it('backlog(task-sync): link read が DB error なら defer(dead にしない・外部を叩かない)', async () => {
      state.linkError = true
      claimReturns([job('conn-backlog', 'complete', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(completeCall('defer')).toBeTruthy()
      expect(completeTaskMock).not.toHaveBeenCalled()
      expect(s.deferred).toBe(1)
      expect(s.dead).toBe(0)
      expect(s.tempFailed).toBe(0)
    })

    it('google_tasks: link 不在(DB error ではない・書き戻し先未設定)は従来どおり permanent_fail=dead', async () => {
      state.links = [] // linkError=false・row 不在
      claimReturns([job('conn-gtasks', 'complete', {}, { created_at: recentCreatedAt() })])
      const s = await dispatchConnectorJobsBatch()
      expect(s.dead).toBe(1)
      expect(s.deferred).toBe(0)
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

describe('dispatchConnectorJobsBatch — per-connection 分離 (Critical1 同型)', () => {
  it('1接続の completion RPC が throw してもバッチは落ちず、他接続は処理される', async () => {
    // multica と gtasks の2接続。multica のジョブの完了RPCだけを一時的に落とす。
    claimReturns([job('conn-multica', 'upsert'), job('conn-gtasks', 'complete')])
    rpcMock.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'rpc_claim_connector_jobs') {
        return Promise.resolve({
          data: [job('conn-multica', 'upsert'), job('conn-gtasks', 'complete')],
          error: null,
        })
      }
      if (name === 'rpc_complete_connector_job') {
        const jobId = (args as { p_job_id?: string } | undefined)?.p_job_id
        // multica のジョブの完了だけ throw(RPC瞬断を模す)。gtasks は成功。
        if (typeof jobId === 'string' && jobId.includes('conn-multica')) {
          return Promise.reject(new Error('rpc_complete_connector_job transient'))
        }
      }
      return Promise.resolve({ data: null, error: null })
    })

    // バッチが throw せず summary を返す(=1接続の失敗で全体が中断しない)。
    const s = await dispatchConnectorJobsBatch()
    expect(s).toBeDefined()

    // gtasks 接続のジョブの completion が呼ばれている(=multica で中断せず後続に進んだ)。
    const gtasksCompleted = rpcMock.mock.calls.some(
      (c) => c[0] === 'rpc_complete_connector_job' &&
        typeof (c[1] as { p_job_id?: string })?.p_job_id === 'string' &&
        (c[1] as { p_job_id: string }).p_job_id.includes('conn-gtasks'),
    )
    expect(gtasksCompleted).toBe(true)
  })
})
