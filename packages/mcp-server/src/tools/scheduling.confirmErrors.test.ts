import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * confirm_proposal_slot は、rpc_confirm_proposal_slot_as が返す
 * {ok:false, error:<コード>} を、決まった日本語の ToolUserError に置き換える。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PROPOSAL = '00000000-0000-0000-0000-000000000003'
const SLOT = '00000000-0000-0000-0000-000000000004'
const ACTOR = '00000000-0000-0000-0000-000000000099'

let rpcResult: { data: unknown; error: unknown } = { data: { ok: true }, error: null }

function chain() {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: { id: PROPOSAL }, error: null })
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: { id: PROPOSAL }, error: null })
        return () => proxy
      },
    }
  )
  return proxy
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'scheduling_proposals') return chain()
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: async () => rpcResult,
  }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () => ({ allowed: true, role: 'admin' }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'fallback-actor' },
  getAuthContext: () => ({ userId: ACTOR }),
}))

const { schedulingConfirm } = await import('./scheduling.js')

beforeEach(() => {
  rpcResult = { data: { ok: true }, error: null }
})

describe('confirm_proposal_slot — RPCの断りの理由を決まった日本語にする', () => {
  it('not_all_agreed は ToolUserError(409)', async () => {
    rpcResult = { data: { ok: false, error: 'not_all_agreed' }, error: null }

    const err = await schedulingConfirm({ spaceId: SPACE, proposalId: PROPOSAL, slotId: SLOT }).catch(
      (e: unknown) => e
    )

    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
  })

  it('proposal_not_open は ToolUserError(409) で現在の状態を含める', async () => {
    rpcResult = { data: { ok: false, error: 'proposal_not_open', current_status: 'cancelled' }, error: null }

    const err = await schedulingConfirm({ spaceId: SPACE, proposalId: PROPOSAL, slotId: SLOT }).catch(
      (e: unknown) => e
    )

    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toContain('cancelled')
  })

  it('not_authorized は ToolUserError(403)', async () => {
    rpcResult = { data: { ok: false, error: 'not_authorized' }, error: null }

    const err = await schedulingConfirm({ spaceId: SPACE, proposalId: PROPOSAL, slotId: SLOT }).catch(
      (e: unknown) => e
    )

    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })
})
