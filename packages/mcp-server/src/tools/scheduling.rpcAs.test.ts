import { describe, it, expect, vi } from 'vitest'

/**
 * confirm_proposal_slot は、auth.uid() 頼みの rpc_confirm_proposal_slot ではなく、
 * 鍵の利用者(actor)を明示して渡す rpc_confirm_proposal_slot_as を呼ぶ。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PROPOSAL = '00000000-0000-0000-0000-000000000003'
const SLOT = '00000000-0000-0000-0000-000000000004'
const ACTOR = '00000000-0000-0000-0000-000000000099'

let authContextUserId: string | null = ACTOR
const rpcCalls: Array<{ name: string; params: unknown }> = []

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: () => {
      throw new Error('confirm_proposal_slot はテーブルを直接読まない前提')
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
  getAuthContext: () => ({ userId: authContextUserId }),
}))

const { schedulingConfirm } = await import('./scheduling.js')

describe('confirm_proposal_slot — actor を明示して rpc_confirm_proposal_slot_as を呼ぶ', () => {
  it('rpc_confirm_proposal_slot_as に p_actor(鍵の利用者) を渡す', async () => {
    rpcCalls.length = 0
    authContextUserId = ACTOR

    await schedulingConfirm({ spaceId: SPACE, proposalId: PROPOSAL, slotId: SLOT })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('rpc_confirm_proposal_slot_as')
    expect(rpcCalls[0].params).toMatchObject({ p_actor: ACTOR, p_proposal_id: PROPOSAL, p_slot_id: SLOT })
  })

  it('鍵に利用者が紐づいていなければ ToolUserError(400) で断る', async () => {
    authContextUserId = null

    const err = await schedulingConfirm({ spaceId: SPACE, proposalId: PROPOSAL, slotId: SLOT }).catch(
      (e: unknown) => e
    )
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })
})
