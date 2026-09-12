import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * meeting_create の participantIds は、画面の参加者選択肢と同じ範囲
 * （そのプロジェクトのメンバー）に限る。
 */

const participantInserts: Array<Record<string, unknown>> = []
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
    if (table === 'meeting_participants') {
      for (const row of Array.isArray(payload) ? payload : [payload]) participantInserts.push(row)
    }
    return c
  }
  c.single = async () =>
    table === 'spaces' ? { data: { org_id: 'org-1' }, error: null } : { data: { id: 'm-1' }, error: null }
  return c
}

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'stale-actor' },
  getAuthContext: () => ({
    keyId: 'k',
    userId: 'user-1',
    orgId: 'org-1',
    scope: 'space',
    allowedSpaceIds: null,
    allowedActions: ['read', 'write'],
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))

const { meetingCreate } = await import('./meetings.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const MEMBER = '00000000-0000-0000-0000-0000000000a1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000ff'

beforeEach(() => {
  participantInserts.length = 0
  spaceMemberIds = [MEMBER]
})

describe('meeting_create — participantIds はプロジェクトのメンバーに限る', () => {
  it('メンバーを指定すると参加者に登録される', async () => {
    await meetingCreate({ spaceId: SPACE, title: '定例', participantIds: [MEMBER] })
    expect(participantInserts).toHaveLength(1)
    expect(participantInserts[0]).toMatchObject({ user_id: MEMBER })
  })

  it('メンバーでない人を指定すると拒否する', async () => {
    const err = await meetingCreate({ spaceId: SPACE, title: '定例', participantIds: [OUTSIDER] }).catch(
      (e: unknown) => e
    )
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(participantInserts).toHaveLength(0)
  })
})
