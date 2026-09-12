import { describe, it, expect, vi } from 'vitest'

/**
 * meeting_start / meeting_end は、auth.uid() 頼みの rpc_meeting_start / rpc_meeting_end ではなく、
 * 鍵の利用者(actor)を明示して渡す rpc_meeting_start_as / rpc_meeting_end_as を呼ぶ。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const MEETING = '00000000-0000-0000-0000-000000000002'
const ACTOR = '00000000-0000-0000-0000-000000000099'

const MEETING_ROW = { id: MEETING, title: 'm' }

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
      if (table === 'meetings') return makeChain({ data: MEETING_ROW, error: null }, { data: [MEETING_ROW], error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { data: { summary_subject: '', summary_body: '', counts: { decided: 0, open: 0, ball_client: 0 } }, error: null }
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: authContextUserId }) }))

const { meetingStart, meetingEnd } = await import('./meetings.js')

describe('meeting_start / meeting_end — actor を明示して _as RPC を呼ぶ', () => {
  it('meeting_start は rpc_meeting_start_as に p_actor を渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await meetingStart({ spaceId: SPACE, meetingId: MEETING })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_meeting_start_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_meeting_id: MEETING })
  })

  it('meeting_start は鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    authContextUserId = null

    const err = await meetingStart({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })

  it('meeting_end は rpc_meeting_end_as に p_actor を渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await meetingEnd({ spaceId: SPACE, meetingId: MEETING })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_meeting_end_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_meeting_id: MEETING })
  })

  it('meeting_end は鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    authContextUserId = null

    const err = await meetingEnd({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })
})
