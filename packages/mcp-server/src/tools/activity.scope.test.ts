import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * activity_log — 道具からの記録は actor_type を常に 'ai' にする（引数の actorType は無視する）。
 * entityId は、許可した表の中でそのプロジェクトに実在する行だけを受け付ける。
 */

const inserts: Array<Record<string, unknown>> = []
let entityExistsInSpace = true

function chain(table: string) {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.maybeSingle = async () => ({ data: entityExistsInSpace ? { id: 'entity-1' } : null, error: null })
  c.single = async () =>
    table === 'spaces' ? { data: { org_id: 'org-1' }, error: null } : { data: { id: 'log-1' }, error: null }
  c.insert = (payload: Record<string, unknown>) => {
    if (table === 'activity_log') inserts.push(payload)
    return c
  }
  return c
}

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('../config.js', () => ({ config: { actorId: 'actor-1' } }))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))

const { activityLog } = await import('./activity.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const ENTITY = '00000000-0000-0000-0000-00000000aaaa'

beforeEach(() => {
  inserts.length = 0
  entityExistsInSpace = true
})

describe('activity_log — actor_type は常に ai', () => {
  it('actorType に user を渡しても ai として記録する', async () => {
    await activityLog({
      spaceId: SPACE,
      entityTable: 'tasks',
      entityId: ENTITY,
      action: 'update',
      actorType: 'user',
      status: 'ok',
    })
    expect(inserts[0]).toMatchObject({ actor_type: 'ai' })
  })
})

describe('activity_log — entityId は許可した表でこのプロジェクトに実在する行だけ', () => {
  it('許可した表(tasks)でこのプロジェクトに実在すれば記録できる', async () => {
    await activityLog({
      spaceId: SPACE,
      entityTable: 'tasks',
      entityId: ENTITY,
      action: 'update',
      actorType: 'ai',
      status: 'ok',
    })
    expect(inserts).toHaveLength(1)
  })

  it('許可した表でも、このプロジェクトに実在しなければ拒否する', async () => {
    entityExistsInSpace = false

    const err = await activityLog({
      spaceId: SPACE,
      entityTable: 'tasks',
      entityId: ENTITY,
      action: 'update',
      actorType: 'ai',
      status: 'ok',
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(inserts).toHaveLength(0)
  })

  it('許可していない表を指定すると拒否する', async () => {
    const err = await activityLog({
      spaceId: SPACE,
      entityTable: 'auth_users',
      entityId: ENTITY,
      action: 'update',
      actorType: 'ai',
      status: 'ok',
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(inserts).toHaveLength(0)
  })
})
