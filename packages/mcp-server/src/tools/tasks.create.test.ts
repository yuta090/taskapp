import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_create の status。作成時のステータスは backlog 固定で、CLI から
 * 「最初から todo / in_progress で作る」ができず、作成→update の2回叩きが必要だった。
 * 未指定のときの既定（task=backlog / spec=considering）は変えない。
 */
const inserts: Record<string, unknown>[] = []

function chainFor(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.insert = (payload: Record<string, unknown>) => {
    if (table === 'tasks') inserts.push(payload)
    return chain
  }
  chain.single = async () =>
    table === 'spaces'
      ? { data: { org_id: 'org-1' }, error: null }
      : { data: { id: 't-1' }, error: null }
  return chain
}

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: (t: string) => chainFor(t) }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskCreate, taskCreateSchema } = await import('./tasks.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const base = { spaceId: SPACE, title: 'T', type: 'task' as const, ball: 'internal' as const, origin: 'internal' as const, clientScope: 'deliverable' as const, clientOwnerIds: [], internalOwnerIds: [] }

describe('task_create status', () => {
  beforeEach(() => { inserts.length = 0 })

  it('status を指定すると、そのステータスで作られる', async () => {
    await taskCreate({ ...base, status: 'in_progress' })
    expect(inserts[0]).toMatchObject({ status: 'in_progress' })
  })

  it('status 未指定なら従来どおり backlog（通常タスク）', async () => {
    await taskCreate({ ...base })
    expect(inserts[0]).toMatchObject({ status: 'backlog' })
  })

  it('status 未指定の仕様タスク(type=spec)は従来どおり considering', async () => {
    await taskCreate({ ...base, type: 'spec', specPath: '/spec/v1/a.md#x' })
    expect(inserts[0]).toMatchObject({ status: 'considering' })
  })

  it('スキーマは画面と同じ6種のステータスだけを受け付ける', () => {
    for (const s of ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']) {
      expect(taskCreateSchema.safeParse({ ...base, status: s }).success).toBe(true)
    }
    expect(taskCreateSchema.safeParse({ ...base, status: 'archived' }).success).toBe(false)
  })
})
