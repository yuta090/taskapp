import { describe, it, expect, vi } from 'vitest'

/**
 * list_scheduling_proposals / cancel_scheduling_proposal(cancel・extend) は、
 * 見覚えのないDBの理由を、生の文言を出さない一般のエラーにする。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PROPOSAL = '00000000-0000-0000-0000-000000000003'

let listError: { code: string; message: string } | null = null
let updateError: { code: string; message: string } | null = null

function chain(table: string) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c
  c.update = () => c
  c.single = async () => ({ data: { id: PROPOSAL, status: 'open', space_id: SPACE, created_by: 'actor-1' }, error: null })
  c.then = (resolve: (v: unknown) => void) =>
    resolve(table === 'scheduling_proposals' && updateError ? { data: null, error: updateError } : { data: listError ? null : [], error: listError })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () => ({ allowed: true, role: 'admin' }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ userId: 'actor-1' }),
}))

const { schedulingList, schedulingCancel } = await import('./scheduling.js')

describe('list_scheduling_proposals — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('一覧の取得に失敗', async () => {
    listError = { code: '42501', message: 'permission denied for table scheduling_proposals' }

    const err = await schedulingList({ spaceId: SPACE, limit: 50 }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('cancel_scheduling_proposal — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('キャンセルに失敗', async () => {
    listError = null
    updateError = { code: '42501', message: 'permission denied for table scheduling_proposals' }

    const err = await schedulingCancel({ spaceId: SPACE, proposalId: PROPOSAL, action: 'cancel' }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('期限延長に失敗', async () => {
    listError = null
    updateError = { code: '42501', message: 'permission denied for table scheduling_proposals' }

    const err = await schedulingCancel({
      spaceId: SPACE,
      proposalId: PROPOSAL,
      action: 'extend',
      newExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})
