import { describe, it, expect, vi } from 'vitest'

/**
 * confirm_proposal_slot は、rpc_confirm_proposal_slot_as を呼ぶ前に、
 * 提案(proposalId)が渡された space のものであることを確かめる。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const OTHER_SPACE = '00000000-0000-0000-0000-000000000099'
const PROPOSAL = '00000000-0000-0000-0000-000000000003'
const SLOT = '00000000-0000-0000-0000-000000000004'
const ACTOR = '00000000-0000-0000-0000-000000000099'

let proposalRow: { id: string } | null = { id: PROPOSAL }
const rpcCalls: Array<{ name: string; params: unknown }> = []

function chain() {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: proposalRow, error: null })
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: proposalRow, error: null })
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
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { data: { ok: true, meeting_id: 'meeting-1', slot_start: 's', slot_end: 'e' }, error: null }
    },
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

describe('confirm_proposal_slot — proposalId は渡された space のものだけ', () => {
  it('同じ space の提案なら rpc_confirm_proposal_slot_as を呼ぶ', async () => {
    proposalRow = { id: PROPOSAL }
    rpcCalls.length = 0

    await schedulingConfirm({ spaceId: SPACE, proposalId: PROPOSAL, slotId: SLOT })

    expect(rpcCalls).toHaveLength(1)
  })

  it('別の space の提案なら、RPCを呼ばずに断る', async () => {
    proposalRow = null
    rpcCalls.length = 0

    const err = await schedulingConfirm({ spaceId: OTHER_SPACE, proposalId: PROPOSAL, slotId: SLOT }).catch(
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(Error)
    expect(rpcCalls).toHaveLength(0)
  })
})
