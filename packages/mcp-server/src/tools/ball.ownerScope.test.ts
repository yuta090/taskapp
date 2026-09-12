import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ball_pass の clientOwnerIds / internalOwnerIds は、画面の担当者選択肢と同じ範囲
 * （そのプロジェクトのメンバー）に限る。rpc_pass_ball_as 自体は担当者の所属を
 * 確かめないため、道具の側で確かめてから呼ぶ。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0000-000000000099'
const MEMBER = '00000000-0000-0000-0000-0000000000a1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000ff'

const TASK_ROW = { id: TASK, title: 't', task_internal_metrics: { actual_hours: null } }

let spaceMemberIds: string[] = [MEMBER]
const rpcCalls: Array<{ name: string; params: unknown }> = []

function chain(table: string) {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.in = (_col: string, ids: string[]) =>
    Promise.resolve({
      data: ids.filter((id) => spaceMemberIds.includes(id)).map((id) => ({ user_id: id })),
      error: null,
    })
  c.single = async () => {
    if (table === 'spaces') return { data: { org_id: ORG }, error: null }
    if (table === 'tasks') return { data: TASK_ROW, error: null }
    throw new Error(`unexpected table: ${table}`)
  }
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => chain(table),
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { error: null }
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: ACTOR }) }))

const { ballPass } = await import('./ball.js')

beforeEach(() => {
  rpcCalls.length = 0
  spaceMemberIds = [MEMBER]
})

describe('ball_pass — clientOwnerIds / internalOwnerIds はプロジェクトのメンバーに限る', () => {
  it('メンバーを指定すると rpc_pass_ball_as が呼ばれる', async () => {
    await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [MEMBER],
    })

    expect(rpcCalls).toHaveLength(1)
  })

  it('internalOwnerIds にメンバーでない人がいると拒否する', async () => {
    const err = await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [OUTSIDER],
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('clientOwnerIds にメンバーでない人がいると拒否する', async () => {
    const err = await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'client',
      clientOwnerIds: [OUTSIDER],
      internalOwnerIds: [],
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(rpcCalls).toHaveLength(0)
  })
})
