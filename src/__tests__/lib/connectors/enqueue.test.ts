import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/connectors/enqueue.ts — connector_jobs(アウトボックス)への enqueue 共通実装(fold付き)。
 * 元は google-tasks/import.ts の private 関数だったものを、multica webhook 受信側(inbound.ts)からも
 * 使うため共有モジュールへ切り出した。fold(既存pendingの上書き・version+1)の直接的な単体テスト。
 */

interface JobRow {
  id: string
  connection_id: string
  task_id: string
  op: string
  payload: Record<string, unknown>
  status: string
  version: number
}

const state = {
  jobs: [] as JobRow[],
  idSeq: 0,
}

function makeChain() {
  let mode: 'select' | 'insert' | 'update' | null = null
  let insertPayload: Record<string, unknown> | null = null
  let updatePayload: Record<string, unknown> | null = null
  const eqFilters: Record<string, unknown> = {}

  function resolveNow(): { data: unknown; error: unknown } {
    if (mode === 'insert') {
      const p = insertPayload as unknown as { connection_id: string; task_id: string; op: string; payload: Record<string, unknown> }
      const conflict = state.jobs.find(
        (j) => j.connection_id === p.connection_id && j.task_id === p.task_id && j.status === 'pending',
      )
      if (conflict) return { data: null, error: { code: '23505' } }
      state.jobs.push({
        id: `job-${++state.idSeq}`,
        connection_id: p.connection_id,
        task_id: p.task_id,
        op: p.op,
        payload: p.payload,
        status: 'pending',
        version: 1,
      })
      return { data: null, error: null }
    }
    if (mode === 'update') {
      const row = state.jobs.find((j) => j.id === eqFilters.id)
      if (row) Object.assign(row, updatePayload)
      return { data: null, error: null }
    }
    // select(fold前の既存pending検索)
    const rows = state.jobs.filter((j) => {
      if (eqFilters.connection_id && j.connection_id !== eqFilters.connection_id) return false
      if (eqFilters.task_id && j.task_id !== eqFilters.task_id) return false
      if (eqFilters.status && j.status !== eqFilters.status) return false
      return true
    })
    return { data: rows[0] ?? null, error: null }
  }

  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: vi.fn(() => {
      if (!mode) mode = 'select'
      return chain
    }),
    insert: vi.fn((v: Record<string, unknown>) => {
      mode = 'insert'
      insertPayload = v
      return chain
    }),
    update: vi.fn((v: Record<string, unknown>) => {
      mode = 'update'
      updatePayload = v
      return chain
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqFilters[col] = val
      return chain
    }),
    maybeSingle: vi.fn(() => Promise.resolve(resolveNow())),
    then: (resolve: (v: unknown) => unknown) => resolve(resolveNow()),
  })
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn(() => makeChain()) })),
}))

const { enqueueConnectorJob } = await import('@/lib/connectors/enqueue')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  state.jobs = []
  state.idSeq = 0
})

describe('enqueueConnectorJob', () => {
  it('pendingが無ければ新規insertする', async () => {
    await enqueueConnectorJob('conn-1', 'task-1', 'upsert', { title: 'x' })
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs[0]).toMatchObject({ connection_id: 'conn-1', task_id: 'task-1', op: 'upsert', version: 1 })
  })

  it('同一(connection,task)にpendingがあれば新しいop/payloadでfoldしversionを進める', async () => {
    await enqueueConnectorJob('conn-1', 'task-1', 'upsert', { title: '古い' })
    await enqueueConnectorJob('conn-1', 'task-1', 'upsert', { title: '新しい' })
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs[0].version).toBe(2)
    expect(state.jobs[0].payload).toEqual({ title: '新しい' })
  })

  it('op=completeでもenqueueできる(multica webhook受信からのgtasks書き戻し用)', async () => {
    await enqueueConnectorJob('conn-gtasks', 'task-1', 'complete', {})
    expect(state.jobs[0]).toMatchObject({ op: 'complete' })
  })

  it('別の(connection,task)は別ジョブとして扱う(foldしない)', async () => {
    await enqueueConnectorJob('conn-1', 'task-1', 'upsert', {})
    await enqueueConnectorJob('conn-1', 'task-2', 'upsert', {})
    expect(state.jobs).toHaveLength(2)
  })
})
