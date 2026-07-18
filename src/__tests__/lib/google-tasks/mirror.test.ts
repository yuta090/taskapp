import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/google-tasks/mirror.ts — 順方向ミラーワーカー。
 * jobs を claim → Google Tasks へ op 別反映 → 結果確定(done/backoff/dead)。
 */

// --- Google Tasks client をモック ---
const insertTaskMock = vi.fn()
const patchTaskMock = vi.fn()
const deleteTaskMock = vi.fn()
const ensureTaskListMock = vi.fn()
vi.mock('@/lib/google-tasks/client', () => ({
  insertTask: (...a: unknown[]) => insertTaskMock(...a),
  patchTask: (...a: unknown[]) => patchTaskMock(...a),
  deleteTask: (...a: unknown[]) => deleteTaskMock(...a),
  ensureTaskList: (...a: unknown[]) => ensureTaskListMock(...a),
  dateToGoogleDue: (d: string | null | undefined) => (d ? `${d}T00:00:00.000Z` : null),
}))

// --- token-manager をモック ---
const getValidTokenDetailedMock = vi.fn()
vi.mock('@/lib/integrations/token-manager', () => ({
  getValidTokenDetailed: (...a: unknown[]) => getValidTokenDetailedMock(...a),
}))
vi.mock('@/lib/google-calendar/client', () => ({ refreshAccessToken: vi.fn() }))

// --- supabase をモック ---
const rpcMock = vi.fn()
const state = {
  conn: { metadata: { tasklist_id: 'list-1' } } as Record<string, unknown> | null,
  ref: null as { google_task_id: string; google_tasklist_id: string } | null,
  upserts: [] as Array<{ table: string; value: unknown }>,
  deletes: [] as string[],
  updates: [] as Array<{ table: string; value: unknown }>,
  // DBエラー注入用（既定 null＝成功）。
  refError: null as { message: string } | null, // maybeSingle(refs) が返すエラー
  writeError: null as { message: string } | null, // upsert/update/delete の await が返すエラー
}
function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn((v: unknown) => {
      state.updates.push({ table, value: v })
      return chain
    }),
    upsert: vi.fn((v: unknown) => {
      state.upserts.push({ table, value: v })
      return chain
    }),
    delete: vi.fn(() => {
      state.deletes.push(table)
      return chain
    }),
    single: vi.fn(() =>
      Promise.resolve({ data: table === 'integration_connections' ? state.conn : null, error: null }),
    ),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: table === 'user_task_mirror_refs' ? state.ref : null,
        error: table === 'user_task_mirror_refs' ? state.refError : null,
      }),
    ),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: state.writeError }),
  })
  return chain
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: rpcMock,
    from: vi.fn((table: string) => makeChain(table)),
  })),
}))

const { dispatchTaskMirrorBatch } = await import('@/lib/google-tasks/mirror')

const CONN = 'conn-1'
function job(op: string, payload: Record<string, unknown> = {}, id = 'job-1') {
  return { id, connection_id: CONN, task_id: 'task-1', op, payload, attempt: 0, version: 1, leased_until: null }
}
function claimReturns(jobs: unknown[]) {
  rpcMock.mockImplementation((name: string) =>
    name === 'rpc_claim_task_mirror_jobs'
      ? Promise.resolve({ data: jobs, error: null })
      : Promise.resolve({ data: null, error: null }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  state.conn = { metadata: { tasklist_id: 'list-1' } }
  state.ref = null
  state.upserts = []
  state.deletes = []
  state.updates = []
  state.refError = null
  state.writeError = null
  getValidTokenDetailedMock.mockResolvedValue({ status: 'ok', token: 'access-token' })
  insertTaskMock.mockResolvedValue({ id: 'gt-new' })
  patchTaskMock.mockResolvedValue({ id: 'gt-1' })
  deleteTaskMock.mockResolvedValue(undefined)
})

describe('dispatchTaskMirrorBatch', () => {
  it('ジョブが無ければ何もしない', async () => {
    claimReturns([])
    const s = await dispatchTaskMirrorBatch()
    expect(s).toEqual({ claimed: 0, done: 0, tempFailed: 0, dead: 0 })
    expect(insertTaskMock).not.toHaveBeenCalled()
  })

  it('upsert(ref無し) → insertTask して ref を保存し done', async () => {
    claimReturns([job('upsert', { title: 'やること', due_date: '2026-07-20' })])
    const s = await dispatchTaskMirrorBatch()

    expect(insertTaskMock).toHaveBeenCalledWith('access-token', 'list-1', {
      title: 'やること',
      notes: undefined,
      due: '2026-07-20T00:00:00.000Z',
      status: 'needsAction',
    })
    expect(state.upserts.find((u) => u.table === 'user_task_mirror_refs')).toBeTruthy()
    const doneCall = rpcMock.mock.calls.find(
      (c) => c[0] === 'rpc_complete_task_mirror_job' && (c[1] as { p_outcome: string }).p_outcome === 'done',
    )
    expect(doneCall).toBeTruthy()
    expect(s.done).toBe(1)
  })

  it('upsert(ref有り) → patchTask で既存 Google task を更新(insertしない)', async () => {
    state.ref = { google_task_id: 'gt-existing', google_tasklist_id: 'list-1' }
    claimReturns([job('upsert', { title: '更新後' })])
    await dispatchTaskMirrorBatch()

    expect(patchTaskMock).toHaveBeenCalledWith(
      'access-token',
      'list-1',
      'gt-existing',
      expect.objectContaining({ title: '更新後', status: 'needsAction' }),
    )
    expect(insertTaskMock).not.toHaveBeenCalled()
  })

  it('complete → payload.google_task_id を status=completed に patch', async () => {
    claimReturns([job('complete', { google_task_id: 'gt-9', google_tasklist_id: 'list-1' })])
    await dispatchTaskMirrorBatch()
    expect(patchTaskMock).toHaveBeenCalledWith('access-token', 'list-1', 'gt-9', { status: 'completed' })
  })

  it('delete → deleteTask して ref を掃除', async () => {
    claimReturns([job('delete', { google_task_id: 'gt-9', google_tasklist_id: 'list-1' })])
    await dispatchTaskMirrorBatch()
    expect(deleteTaskMock).toHaveBeenCalledWith('access-token', 'list-1', 'gt-9')
    expect(state.deletes).toContain('user_task_mirror_refs')
  })

  it('delete(google_task_id が無い=Google未作成) → API を叩かず ref 掃除のみ', async () => {
    claimReturns([job('delete', {})])
    await dispatchTaskMirrorBatch()
    expect(deleteTaskMock).not.toHaveBeenCalled()
    expect(state.deletes).toContain('user_task_mirror_refs')
  })

  it('トークンが失効(auth_failed) → Google を叩かず temporary_fail で寝かせる', async () => {
    getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })
    claimReturns([job('upsert', { title: 'x' })])
    const s = await dispatchTaskMirrorBatch()

    expect(insertTaskMock).not.toHaveBeenCalled()
    const failCall = rpcMock.mock.calls.find(
      (c) => c[0] === 'rpc_complete_task_mirror_job' && (c[1] as { p_outcome: string }).p_outcome === 'temporary_fail',
    )
    expect(failCall).toBeTruthy()
    expect(s.tempFailed).toBe(1)
  })

  it('404(毒) → permanent_fail=dead にする', async () => {
    insertTaskMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    claimReturns([job('upsert', { title: 'x' })])
    const s = await dispatchTaskMirrorBatch()
    const deadCall = rpcMock.mock.calls.find(
      (c) => c[0] === 'rpc_complete_task_mirror_job' && (c[1] as { p_outcome: string }).p_outcome === 'permanent_fail',
    )
    expect(deadCall).toBeTruthy()
    expect(s.dead).toBe(1)
  })

  it('500(一時) → temporary_fail で再試行に回す', async () => {
    insertTaskMock.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }))
    claimReturns([job('upsert', { title: 'x' })])
    const s = await dispatchTaskMirrorBatch()
    expect(s.tempFailed).toBe(1)
    expect(s.dead).toBe(0)
  })

  it('metadata に tasklist_id が無ければ ensureTaskList で作り metadata に保存', async () => {
    state.conn = { metadata: {} }
    ensureTaskListMock.mockResolvedValue('list-created')
    claimReturns([job('upsert', { title: 'x' })])
    await dispatchTaskMirrorBatch()

    expect(ensureTaskListMock).toHaveBeenCalledWith('access-token', 'TaskApp')
    const metaUpdate = state.updates.find((u) => u.table === 'integration_connections')
    expect((metaUpdate?.value as { metadata: { tasklist_id: string } }).metadata.tasklist_id).toBe('list-created')
    expect(insertTaskMock).toHaveBeenCalledWith('access-token', 'list-created', expect.anything())
  })
})

// 見つけやすさのためのヘルパ: 指定 outcome の complete 呼び出しを返す。
function completeCall(outcome: string) {
  return rpcMock.mock.calls.find(
    (c) =>
      c[0] === 'rpc_complete_task_mirror_job' && (c[1] as { p_outcome: string }).p_outcome === outcome,
  )
}

describe('並行性・エラー処理レビュー対応（fable設計: version/lease/ref-first/補償）', () => {
  it('complete RPC に job.version を渡す（処理中 fold を RPC 側で弾けるように）', async () => {
    claimReturns([{ ...job('upsert', { title: 'x' }), version: 7 }])
    await dispatchTaskMirrorBatch()
    const done = completeCall('done')
    expect((done?.[1] as { p_version: number }).p_version).toBe(7)
  })

  it('#6 getRef の DBエラーを ref=null と誤認せず temporary_fail（二重作成を防ぐ）', async () => {
    state.refError = { message: 'db down' }
    claimReturns([job('upsert', { title: 'x' })])
    const s = await dispatchTaskMirrorBatch()
    expect(insertTaskMock).not.toHaveBeenCalled() // ref 不明のまま insert しない
    expect(s.tempFailed).toBe(1)
    expect(s.done).toBe(0)
  })

  it('#5 insert 成功→saveRef 失敗 は補償 delete して temporary_fail（done にしない）', async () => {
    state.ref = null
    insertTaskMock.mockResolvedValue({ id: 'gt-created' })
    state.writeError = { message: 'ref upsert failed' } // saveRef の upsert がエラー
    claimReturns([job('upsert', { title: 'x' })])
    const s = await dispatchTaskMirrorBatch()
    // 作ったばかりの Google タスクを補償 delete する
    expect(deleteTaskMock).toHaveBeenCalledWith('access-token', 'list-1', 'gt-created')
    expect(s.tempFailed).toBe(1)
    expect(completeCall('done')).toBeUndefined()
  })

  it('#7 delete は payload に ID が無くても refs から解決して削除する', async () => {
    state.ref = { google_task_id: 'gt-ref', google_tasklist_id: 'list-ref' }
    claimReturns([job('delete', {})]) // payload に google_task_id 無し
    await dispatchTaskMirrorBatch()
    expect(deleteTaskMock).toHaveBeenCalledWith('access-token', 'list-ref', 'gt-ref')
    expect(state.deletes).toContain('user_task_mirror_refs') // ref も掃除
  })

  it('complete の 404（既に消えている）は dead にせず done 扱い', async () => {
    state.ref = { google_task_id: 'gt-1', google_tasklist_id: 'list-1' }
    patchTaskMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    claimReturns([job('complete', {})])
    const s = await dispatchTaskMirrorBatch()
    expect(s.done).toBe(1)
    expect(s.dead).toBe(0)
  })

  it('#7 due_date を消した upsert は Google へ due:null を送って期日を消す', async () => {
    state.ref = { google_task_id: 'gt-1', google_tasklist_id: 'list-1' }
    claimReturns([job('upsert', { title: 'x' })]) // due_date 無し
    await dispatchTaskMirrorBatch()
    expect(patchTaskMock).toHaveBeenCalledWith(
      'access-token',
      'list-1',
      'gt-1',
      expect.objectContaining({ due: null }),
    )
  })

  it('lease 切れの行は処理せずスキップ（complete を呼ばない）', async () => {
    const stale = { ...job('upsert', { title: 'x' }), leased_until: '2000-01-01T00:00:00.000Z' }
    claimReturns([stale])
    const s = await dispatchTaskMirrorBatch()
    expect(insertTaskMock).not.toHaveBeenCalled()
    expect(rpcMock.mock.calls.find((c) => c[0] === 'rpc_complete_task_mirror_job')).toBeUndefined()
    expect(s.done).toBe(0)
  })
})
