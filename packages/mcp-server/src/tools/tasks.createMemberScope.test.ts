import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_create の担当者・担当者一覧(assigneeId・clientOwnerIds・internalOwnerIds)は、
 * 画面の担当者選択肢と同じ範囲（そのプロジェクトのメンバー）に限る。
 */

const inserts: Record<string, unknown>[] = []
let spaceMemberIds: string[] = []

function chainFor(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.in = (col: string, ids: string[]) => {
    const found = ids.filter((id) => spaceMemberIds.includes(id))
    return Promise.resolve({ data: found.map((id) => ({ user_id: id })), error: null })
  }
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

const { taskCreate } = await import('./tasks.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const MEMBER = '00000000-0000-0000-0000-0000000000a1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000ff'
const base = {
  spaceId: SPACE,
  title: 'T',
  type: 'task' as const,
  ball: 'internal' as const,
  origin: 'internal' as const,
  clientScope: 'deliverable' as const,
}

beforeEach(() => {
  inserts.length = 0
  spaceMemberIds = [MEMBER]
})

describe('task_create — 担当者はプロジェクトのメンバーに限る', () => {
  it('メンバーを assigneeId に指定すると作成できる', async () => {
    await taskCreate({ ...base, assigneeId: MEMBER, clientOwnerIds: [], internalOwnerIds: [] })
    expect(inserts[0]).toMatchObject({ assignee_id: MEMBER })
  })

  it('メンバーでない人を assigneeId に指定すると拒否する', async () => {
    const err = await taskCreate({ ...base, assigneeId: OUTSIDER, clientOwnerIds: [], internalOwnerIds: [] }).catch(
      (e: unknown) => e
    )
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(inserts).toHaveLength(0)
  })

  it('メンバーでない人を internalOwnerIds に含めると拒否する', async () => {
    const err = await taskCreate({
      ...base,
      ball: 'client',
      clientOwnerIds: [MEMBER],
      internalOwnerIds: [OUTSIDER],
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(inserts).toHaveLength(0)
  })

  it('メンバーでない人を clientOwnerIds に含めると拒否する', async () => {
    const err = await taskCreate({
      ...base,
      ball: 'client',
      clientOwnerIds: [OUTSIDER],
      internalOwnerIds: [],
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(inserts).toHaveLength(0)
  })
})
