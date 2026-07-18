import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/google-tasks/poll.ts — 逆流ポーリング(Google 完了 → TaskApp done)。
 */

const listTasksMock = vi.fn()
vi.mock('@/lib/google-tasks/client', () => ({
  listTasks: (...a: unknown[]) => listTasksMock(...a),
}))

const getValidTokenDetailedMock = vi.fn()
vi.mock('@/lib/integrations/token-manager', () => ({
  getValidTokenDetailed: (...a: unknown[]) => getValidTokenDetailedMock(...a),
}))
vi.mock('@/lib/google-calendar/client', () => ({ refreshAccessToken: vi.fn() }))

const rpcMock = vi.fn()
const state = {
  conns: [] as Array<{ id: string; metadata: Record<string, unknown> | null }>,
  refs: [] as Array<{ task_id: string; google_task_id: string }>,
  updates: [] as Array<{ table: string; value: unknown }>,
}
function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  let eqCount = 0
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => {
      eqCount++
      // integration_connections: .select().eq(provider).eq(status) → 2度目の eq で解決
      if (table === 'integration_connections' && eqCount >= 2) {
        return Promise.resolve({ data: state.conns, error: null })
      }
      // user_task_mirror_refs: .select().eq(connection_id) → 1度で解決
      if (table === 'user_task_mirror_refs') {
        return Promise.resolve({ data: state.refs, error: null })
      }
      return chain
    }),
    update: vi.fn((v: unknown) => {
      state.updates.push({ table, value: v })
      return chain
    }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
  })
  return chain
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: rpcMock, from: vi.fn((t: string) => makeChain(t)) })),
}))

const { pollTaskMirrorBatch } = await import('@/lib/google-tasks/poll')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  state.conns = [{ id: 'conn-1', metadata: { tasklist_id: 'list-1', poll_cursor: '2026-07-18T00:00:00.000Z' } }]
  state.refs = [{ task_id: 'task-1', google_task_id: 'gt-1' }]
  state.updates = []
  getValidTokenDetailedMock.mockResolvedValue({ status: 'ok', token: 'tok' })
  rpcMock.mockResolvedValue({ data: true, error: null })
  listTasksMock.mockResolvedValue({ items: [], nextPageToken: null })
})

describe('pollTaskMirrorBatch', () => {
  it('completed かつ ref がある Google task → rpc_mirror_complete_task で done にする', async () => {
    listTasksMock.mockResolvedValue({
      items: [{ id: 'gt-1', status: 'completed' }],
      nextPageToken: null,
    })
    const s = await pollTaskMirrorBatch()
    expect(rpcMock).toHaveBeenCalledWith('rpc_mirror_complete_task', { p_task_id: 'task-1' })
    expect(s.completed).toBe(1)
  })

  it('updatedMin カーソルを listTasks に渡す', async () => {
    await pollTaskMirrorBatch()
    expect(listTasksMock).toHaveBeenCalledWith(
      'tok',
      'list-1',
      expect.objectContaining({ updatedMin: '2026-07-18T00:00:00.000Z' }),
    )
  })

  it('needsAction(未完了)のタスクは無視する', async () => {
    listTasksMock.mockResolvedValue({ items: [{ id: 'gt-1', status: 'needsAction' }], nextPageToken: null })
    const s = await pollTaskMirrorBatch()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(s.completed).toBe(0)
  })

  it('completed だが ref が無い(TaskApp管理外)タスクは無視する', async () => {
    listTasksMock.mockResolvedValue({ items: [{ id: 'gt-unknown', status: 'completed' }], nextPageToken: null })
    const s = await pollTaskMirrorBatch()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(s.completed).toBe(0)
  })

  it('成功したらカーソルを前進させる', async () => {
    await pollTaskMirrorBatch()
    const upd = state.updates.find((u) => u.table === 'integration_connections')
    expect((upd?.value as { metadata: { poll_cursor: string } }).metadata.poll_cursor).toBeTruthy()
  })

  it('tasklist_id が無い接続は skip(まだ何もミラーしていない)', async () => {
    state.conns = [{ id: 'conn-1', metadata: {} }]
    const s = await pollTaskMirrorBatch()
    expect(listTasksMock).not.toHaveBeenCalled()
    expect(s.skipped).toBe(1)
  })

  it('トークン失効の接続は skip しカーソルを進めない', async () => {
    getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })
    const s = await pollTaskMirrorBatch()
    expect(listTasksMock).not.toHaveBeenCalled()
    expect(s.skipped).toBe(1)
    expect(state.updates).toHaveLength(0)
  })

  it('list が失敗したらカーソルを進めず skip(取りこぼさない)', async () => {
    listTasksMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const s = await pollTaskMirrorBatch()
    expect(s.skipped).toBe(1)
    expect(state.updates).toHaveLength(0)
  })

  it('ページネーション: nextPageToken を辿る', async () => {
    listTasksMock
      .mockResolvedValueOnce({ items: [{ id: 'gt-1', status: 'completed' }], nextPageToken: 'p2' })
      .mockResolvedValueOnce({ items: [], nextPageToken: null })
    await pollTaskMirrorBatch()
    expect(listTasksMock).toHaveBeenCalledTimes(2)
    expect(listTasksMock.mock.calls[1][2]).toEqual(expect.objectContaining({ pageToken: 'p2' }))
  })
})
