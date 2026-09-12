import { describe, it, expect, vi } from 'vitest'

/**
 * list_scheduling_proposals: scheduling_proposals → proposal_slots の外部キーは
 * proposal_slots.proposal_id と scheduling_proposals.confirmed_slot_id の2本あるため、
 * 外部キー名を指定しないと PostgREST の PGRST201（曖昧な関係）で失敗する。
 * Web側 src/app/api/scheduling/proposals/[id]/route.ts は既に proposal_slots_proposal_id_fkey
 * を指定しており、こちらもそれに合わせる。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'

const selectCalls: string[] = []

function chain() {
  const c: Record<string, unknown> = {}
  c.select = (arg: string) => {
    selectCalls.push(arg)
    return c
  }
  for (const m of ['eq', 'order', 'limit']) c[m] = () => c
  c.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: () => chain() }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () => ({ allowed: true, role: 'admin' }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ userId: 'actor-1' }),
}))

const { schedulingList } = await import('./scheduling.js')

describe('list_scheduling_proposals — proposal_slots の埋め込みは外部キー名を指定する', () => {
  it('proposal_slots!proposal_slots_proposal_id_fkey を select に含める', async () => {
    selectCalls.length = 0

    await schedulingList({ spaceId: SPACE, limit: 50 })

    expect(selectCalls[0]).toContain('proposal_slots!proposal_slots_proposal_id_fkey(')
  })
})
