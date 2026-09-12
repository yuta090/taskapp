import { describe, it, expect, vi } from 'vitest'

/**
 * review_open / review_approve / review_block は、auth.uid() 頼みの rpc_review_open /
 * rpc_review_approve / rpc_review_block ではなく、鍵の利用者(actor)を明示して渡す
 * rpc_review_open_as / rpc_review_approve_as / rpc_review_block_as を呼ぶ。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const TASK = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0000-000000000099'

const TASK_ROW = { id: TASK }
const REVIEW_ROW = { id: 'review-1', task_id: TASK, status: 'open' }

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
      if (table === 'reviews') return makeChain({ data: REVIEW_ROW, error: null }, { data: [REVIEW_ROW], error: null })
      if (table === 'space_memberships')
        return makeChain(
          { data: { user_id: ACTOR, role: 'editor' }, error: null },
          { data: [{ user_id: ACTOR, role: 'editor' }], error: null }
        )
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { data: { allApproved: false }, error: null }
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: authContextUserId }) }))

const { reviewOpen, reviewApprove, reviewBlock } = await import('./reviews.js')

describe('review_open / review_approve / review_block — actor を明示して _as RPC を呼ぶ', () => {
  it('review_open は rpc_review_open_as に p_actor を渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: [ACTOR] })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_review_open_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_task_id: TASK })
  })

  it('review_open は鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    authContextUserId = null

    const err = await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: [ACTOR] }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })

  it('review_approve は rpc_review_approve_as に p_actor を渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await reviewApprove({ spaceId: SPACE, taskId: TASK })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_review_approve_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_task_id: TASK })
  })

  it('review_approve は鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    authContextUserId = null

    const err = await reviewApprove({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })

  it('review_block は rpc_review_block_as に p_actor を渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await reviewBlock({ spaceId: SPACE, taskId: TASK, reason: '差し戻し' })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_review_block_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_task_id: TASK })
  })

  it('review_block は鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    authContextUserId = null

    const err = await reviewBlock({ spaceId: SPACE, taskId: TASK, reason: '差し戻し' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })
})
