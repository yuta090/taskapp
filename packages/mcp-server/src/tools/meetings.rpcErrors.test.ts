import { describe, it, expect, vi } from 'vitest'

/**
 * meeting_start / meeting_end は、rpc_meeting_start_as / rpc_meeting_end_as が
 * RAISE EXCEPTION で返す断りの理由を、決まった日本語の ToolUserError に置き換える。
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

let rpcError: { message: string } | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return makeChain({ data: { org_id: ORG }, error: null }, { data: [], error: null })
      if (table === 'meetings') return makeChain({ data: MEETING_ROW, error: null }, { data: [MEETING_ROW], error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async () => ({ error: rpcError }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: ACTOR }) }))

const { meetingStart, meetingEnd } = await import('./meetings.js')

describe('meeting_start / meeting_end — RPCの断りの理由を決まった日本語にする', () => {
  it('meeting_end: 進行中でない会議を終了しようとすると409で現在の状態を含める', async () => {
    rpcError = { message: 'Meeting can only end from in_progress status, current: planned' }

    const err = await meetingEnd({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toContain('planned')
  })

  it('meeting_start: 権限が無い場合は ToolUserError(403)', async () => {
    rpcError = { message: 'Not authorized to access this meeting' }

    const err = await meetingStart({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })
})
