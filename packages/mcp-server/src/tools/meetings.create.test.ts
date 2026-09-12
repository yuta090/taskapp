import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * meeting_create が会議の作成者（created_by）を入れること。
 * meetings.created_by は NOT NULL だが入れておらず、CLI / API からの会議作成は必ず
 * 「会議の作成に失敗しました」（500）になっていた（2026-09-12）。
 * 作成者は、その呼び出しの鍵に紐づく利用者。使い回しの config.actorId は前の呼び出しの値が残るので使わない。
 * 利用者の無い鍵（プロジェクト用の鍵）では、作らずに理由付きで断る。
 */
const inserts: Array<Record<string, unknown>> = []
let userId: string | null = 'user-1'

function chain(table: string) {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.insert = (payload: Record<string, unknown>) => {
    inserts.push({ table, ...payload })
    return c
  }
  c.single = async () =>
    table === 'spaces'
      ? { data: { org_id: 'org-1' }, error: null }
      : { data: { id: 'm-1', ...inserts[inserts.length - 1] }, error: null }
  return c
}

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'stale-actor' },
  getAuthContext: () => ({
    keyId: 'k',
    userId,
    orgId: 'org-1',
    scope: 'space',
    allowedSpaceIds: null,
    allowedActions: ['read', 'write'],
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))

const { meetingCreate } = await import('./meetings.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const meetingRow = () => inserts.find((r) => r.table === 'meetings')

beforeEach(() => {
  inserts.length = 0
  userId = 'user-1'
})

describe('meeting_create の作成者と開催日時', () => {
  it('呼び出した鍵の利用者を created_by に入れる（config.actorId ではない）', async () => {
    await meetingCreate({ spaceId: SPACE, title: '定例', heldAt: '2026-09-11T07:26:00Z', participantIds: [] })

    expect(meetingRow()).toMatchObject({ created_by: 'user-1', held_at: '2026-09-11T07:26:00Z' })
  })

  it('利用者の無い鍵では、作らずに理由付きで断る（400）', async () => {
    userId = null

    await expect(meetingCreate({ spaceId: SPACE, title: '定例', participantIds: [] })).rejects.toMatchObject({
      name: 'ToolUserError',
      status: 400,
    })
    expect(meetingRow()).toBeUndefined()
  })

  it('開催日時を省いたら今の時刻を入れる（held_at は NOT NULL）', async () => {
    await meetingCreate({ spaceId: SPACE, title: '定例', participantIds: [] })

    const heldAt = meetingRow()?.held_at
    expect(typeof heldAt).toBe('string')
    expect(Number.isNaN(Date.parse(heldAt as string))).toBe(false)
  })
})
