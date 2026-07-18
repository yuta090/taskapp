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
      Promise.resolve({ data: table === 'user_task_mirror_refs' ? state.ref : null, error: null }),
    ),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
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
  return { id, connection_id: CONN, task_id: 'task-1', op, payload, attempt: 0 }
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
