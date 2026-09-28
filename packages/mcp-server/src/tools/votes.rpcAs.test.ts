import { describe, it, expect, vi } from 'vitest'

/**
 * vote_cast は、auth.uid() 頼みの rpc_doc_vote_cast ではなく、
 * 鍵の利用者(actor)を明示して渡す rpc_doc_vote_cast_as を呼ぶ。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const POLL = '00000000-0000-0000-0000-000000000f01'
const ACTOR = '00000000-0000-0000-0000-000000000099'

let authContextUserId: string | null = ACTOR
const rpcCalls: Array<{ name: string; params: unknown }> = []

function makeChain(singleResponse: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(singleResponse)
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
      if (table === 'doc_polls') return makeChain({ data: { id: POLL }, error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { data: 'ok', error: null }
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: authContextUserId }) }))

const { voteCast } = await import('./votes.js')

describe('vote_cast — actor を明示して rpc_doc_vote_cast_as を呼ぶ', () => {
  it('choiceをそのまま p_choice に渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ok' })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_doc_vote_cast_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_poll_id: POLL, p_choice: 'ok', p_memo: '' })
  })

  it('choice=none は p_choice=null で取り消しを表す', async () => {
    rpcCalls.length = 0

    await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'none' })

    expect(rpcCalls[0].params).toMatchObject({ p_choice: null })
  })

  it('memo をそのまま p_memo に渡す', async () => {
    rpcCalls.length = 0

    await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ng', memo: '理由です' })

    expect(rpcCalls[0].params).toMatchObject({ p_choice: 'ng', p_memo: '理由です' })
  })

  it('鍵に利用者が紐づいていなければ ToolUserError(400) で断る（RPCは呼ばない）', async () => {
    rpcCalls.length = 0
    authContextUserId = null

    const err = await voteCast({ spaceId: SPACE, pollId: POLL, choice: 'ok' }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(rpcCalls).toHaveLength(0)
  })
})
