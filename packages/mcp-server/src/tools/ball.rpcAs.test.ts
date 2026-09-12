import { describe, it, expect, vi } from 'vitest'

/**
 * ball_pass は、auth.uid() 頼みの rpc_pass_ball ではなく、鍵の利用者(actor)を明示して渡す
 * rpc_pass_ball_as を呼ぶ。actor は道具の引数からではなく、鍵に紐づく利用者から取る。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0000-000000000099'

const TASK_ROW = { id: TASK, title: 't', task_internal_metrics: { actual_hours: null } }

function makeChain(singleResponse: unknown, arrayResponse: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(arrayResponse)
        if (prop === 'single' || prop === 'maybeSingle') return async () => singleResponse
        return () => proxy
      },
    }
  )
  return proxy
}

let authContextUserId: string | null = ACTOR
const rpcCalls: Array<{ name: string; params: unknown }> = []

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return makeChain({ data: { org_id: ORG }, error: null }, { data: [], error: null })
      if (table === 'tasks') return makeChain({ data: TASK_ROW, error: null }, { data: [TASK_ROW], error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { error: null }
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: authContextUserId }) }))

const { ballPass } = await import('./ball.js')

describe('ball_pass — actor を明示して rpc_pass_ball_as を呼ぶ', () => {
  it('rpc_pass_ball_as に p_actor(鍵の利用者) を渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [],
    })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_pass_ball_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_task_id: TASK })
  })

  it('鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    authContextUserId = null

    const err = await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [],
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })
})
