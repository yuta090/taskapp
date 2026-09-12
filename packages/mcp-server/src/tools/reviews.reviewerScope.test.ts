import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * review_open の reviewerIds は、画面の承認者候補と同じ範囲（そのプロジェクトの
 * 社内メンバー=admin/editor）に限る。rpc_review_open_as 自体も断るが、道具側でも
 * 理由の分かる400で先に断る。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0000-000000000099'
const INTERNAL_MEMBER = '00000000-0000-0000-0000-0000000000a1'
const CLIENT_MEMBER = '00000000-0000-0000-0000-0000000000a2'
const OUTSIDER = '00000000-0000-0000-0000-0000000000ff'

const TASK_ROW = { id: TASK }
const REVIEW_ROW = { id: 'review-1', task_id: TASK, status: 'open' }

let spaceMembers: Record<string, string> = {}
const rpcCalls: Array<{ name: string; params: unknown }> = []

function chain(table: string) {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.in = (_col: string, ids: string[]) =>
    Promise.resolve({
      data: ids.filter((id) => id in spaceMembers).map((id) => ({ user_id: id, role: spaceMembers[id] })),
      error: null,
    })
  c.single = async () => {
    if (table === 'spaces') return { data: { org_id: ORG }, error: null }
    if (table === 'tasks') return { data: TASK_ROW, error: null }
    if (table === 'reviews') return { data: REVIEW_ROW, error: null }
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

const { reviewOpen } = await import('./reviews.js')

beforeEach(() => {
  rpcCalls.length = 0
  spaceMembers = {
    [INTERNAL_MEMBER]: 'editor',
    [CLIENT_MEMBER]: 'client',
  }
})

describe('review_open — reviewerIds は社内(admin/editor)に限る', () => {
  it('社内メンバーを指定すると rpc_review_open_as が呼ばれる', async () => {
    await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: [INTERNAL_MEMBER] })

    expect(rpcCalls).toHaveLength(1)
  })

  it('メンバーでない人がいると404で拒否する', async () => {
    const err = await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: [OUTSIDER] }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('相手先側(client)の人を指定すると400で拒否する', async () => {
    const err = await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: [CLIENT_MEMBER] }).catch(
      (e: unknown) => e
    )

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(rpcCalls).toHaveLength(0)
  })
})
