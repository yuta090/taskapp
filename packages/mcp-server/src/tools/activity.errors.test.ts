import { describe, it, expect, vi } from 'vitest'

/**
 * activity_log / activity_search / activity_entity_history は、DBが断った理由を
 * そのまま出さず、決まった短い日本語のエラーにする（生のDB文言は出さない）。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = 'org-1'
const TASK = '00000000-0000-0000-0000-000000000001'

let queryResponse: { data: unknown; error: unknown } = { data: null, error: null }

function chain() {
  const obj: Record<string, unknown> = {
    select: () => obj,
    insert: () => obj,
    eq: () => obj,
    order: () => obj,
    limit: () => obj,
    single: async () => queryResponse,
    then: (resolve: (v: unknown) => void) => resolve(queryResponse),
  }
  return obj
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: ORG }, error: null }) }) }) }
      if (table === 'tasks') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: TASK }, error: null }) }) }) }) }
      return chain()
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }), checkAuthOrg: async () => ({ ctx: { orgId: ORG } }) }))
vi.mock('../config.js', () => ({ config: { actorId: 'actor-1' } }))

const { activityLog, activitySearch, activityEntityHistory } = await import('./activity.js')

describe('activity_log / activity_search / activity_entity_history — DBの生の文言を出さない', () => {
  it('activity_log: 記録に失敗したら、生のDB文言を含まない一般のエラー', async () => {
    queryResponse = { data: null, error: { code: '23503', message: 'insert or update on table "activity_log" violates foreign key constraint' } }

    const err = await activityLog({
      spaceId: SPACE,
      entityTable: 'tasks',
      entityId: TASK,
      action: 'created',
      status: 'success',
    }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('foreign key constraint')
  })

  it('activity_search: 検索に失敗したら、生のDB文言を含まない一般のエラー', async () => {
    queryResponse = { data: null, error: { code: '42501', message: 'permission denied for table activity_log' } }

    const err = await activitySearch({ spaceId: SPACE, limit: 20 }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('activity_entity_history: 取得に失敗したら、生のDB文言を含まない一般のエラー', async () => {
    queryResponse = { data: null, error: { code: '42501', message: 'permission denied for table activity_log' } }

    const err = await activityEntityHistory({ entityTable: 'tasks', entityId: TASK, limit: 20 }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).not.toContain('permission denied')
  })
})
