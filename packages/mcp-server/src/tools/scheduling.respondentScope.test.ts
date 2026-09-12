import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * create_scheduling_proposal の respondents[].userId は、画面の回答者選択肢と
 * 同じ範囲（そのプロジェクトのメンバー）に限る。
 */

const respondentInserts: Array<Record<string, unknown>> = []
let spaceMemberIds: string[] = []

function chain(table: string) {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.in = (_col: string, ids: string[]) =>
    Promise.resolve({
      data: ids.filter((id) => spaceMemberIds.includes(id)).map((id) => ({ user_id: id })),
      error: null,
    })
  c.insert = (payload: Record<string, unknown> | Record<string, unknown>[]) => {
    if (table === 'proposal_respondents') {
      for (const row of Array.isArray(payload) ? payload : [payload]) respondentInserts.push(row)
    }
    return c
  }
  c.single = async () =>
    table === 'spaces'
      ? { data: { org_id: 'org-1' }, error: null }
      : { data: { id: 'proposal-1' }, error: null }
  return c
}

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { schedulingCreate } = await import('./scheduling.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const MEMBER = '00000000-0000-0000-0000-0000000000a1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000ff'
const base = {
  spaceId: SPACE,
  title: '日程調整',
  durationMinutes: 60,
  slots: [
    { startAt: '2026-09-15T01:00:00Z', endAt: '2026-09-15T02:00:00Z' },
    { startAt: '2026-09-16T01:00:00Z', endAt: '2026-09-16T02:00:00Z' },
  ],
}

beforeEach(() => {
  respondentInserts.length = 0
  spaceMemberIds = [MEMBER]
})

describe('create_scheduling_proposal — respondents はプロジェクトのメンバーに限る', () => {
  it('メンバーを回答者に指定すると登録される', async () => {
    await schedulingCreate({
      ...base,
      respondents: [{ userId: MEMBER, side: 'client', isRequired: true }],
    })
    expect(respondentInserts).toHaveLength(1)
    expect(respondentInserts[0]).toMatchObject({ user_id: MEMBER })
  })

  it('メンバーでない人を回答者に指定すると拒否する', async () => {
    const err = await schedulingCreate({
      ...base,
      respondents: [{ userId: OUTSIDER, side: 'client', isRequired: true }],
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(respondentInserts).toHaveLength(0)
  })
})
