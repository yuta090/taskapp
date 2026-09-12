import { describe, it, expect, vi } from 'vitest'

/**
 * ball_pass は、rpc_pass_ball_as が RAISE EXCEPTION で返す断りの理由を、
 * 決まった日本語の ToolUserError に置き換える。
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

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return makeChain({ data: { org_id: ORG }, error: null }, { data: [], error: null })
      if (table === 'tasks') return makeChain({ data: TASK_ROW, error: null }, { data: [TASK_ROW], error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async () => ({ error: { message: 'Not authorized to access this task' } }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: ACTOR }) }))

const { ballPass } = await import('./ball.js')

describe('ball_pass — RPCの断りの理由を決まった日本語にする', () => {
  it('権限が無い場合は ToolUserError(403)', async () => {
    const err = await ballPass({
      spaceId: SPACE,
      taskId: TASK,
      ball: 'internal',
      clientOwnerIds: [],
      internalOwnerIds: [],
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })
})
