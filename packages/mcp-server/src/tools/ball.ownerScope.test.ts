import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ball_pass の clientOwnerIds / internalOwnerIds は、画面の担当者選択肢と同じ範囲
 * （そのプロジェクトのメンバーで、かつ相手先側=client/vendor・社内側=admin/editor/viewer
 * の役割）に限る。rpc_pass_ball_as 自体は担当者の所属・役割を確かめないため、
 * 道具の側で task_create/task_update と同じ確認をしてから呼ぶ。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0000-000000000099'
const INTERNAL_MEMBER = '00000000-0000-0000-0000-0000000000a1'
const CLIENT_MEMBER = '00000000-0000-0000-0000-0000000000a2'
const VENDOR_MEMBER = '00000000-0000-0000-0000-0000000000a3'
const OUTSIDER = '00000000-0000-0000-0000-0000000000ff'

const TASK_ROW = { id: TASK, title: 't', task_internal_metrics: { actual_hours: null } }

let spaceMembers: Record<string, string> = {}
const rpcCalls: Array<{ name: string; params: unknown }> = []

function chain(table: string) {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.in = (_col: string, ids: string[]) =>
    Promise.resolve({
      data: ids
        .filter((id) => id in spaceMembers)
        .map((id) => ({ user_id: id, role: spaceMembers[id] })),
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
  spaceMembers = {
    [INTERNAL_MEMBER]: 'editor',
    [CLIENT_MEMBER]: 'client',
    [VENDOR_MEMBER]: 'vendor',
  }
})

describe('ball_pass — clientOwnerIds / internalOwnerIds は役割まで確かめる', () => {
  it('internalOwnerIdsに社内(admin/editor/viewer)を指定すると rpc_pass_ball_as が呼ばれる', async () => {
    await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [INTERNAL_MEMBER],
    })

    expect(rpcCalls).toHaveLength(1)
  })

  it('clientOwnerIdsに相手先(client/vendor)を指定すると rpc_pass_ball_as が呼ばれる', async () => {
    await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'client',
      clientOwnerIds: [CLIENT_MEMBER, VENDOR_MEMBER],
      internalOwnerIds: [],
    })

    expect(rpcCalls).toHaveLength(1)
  })

  it('internalOwnerIdsにメンバーでない人がいると404で拒否する', async () => {
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

  it('clientOwnerIdsにメンバーでない人がいると404で拒否する', async () => {
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

  it('internalOwnerIdsに相手先側(client)の人を指定すると400で拒否する', async () => {
    const err = await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [CLIENT_MEMBER],
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('clientOwnerIdsに社内側(admin/editor/viewer)の人を指定すると400で拒否する', async () => {
    const err = await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'client',
      clientOwnerIds: [INTERNAL_MEMBER],
      internalOwnerIds: [],
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(rpcCalls).toHaveLength(0)
  })
})
