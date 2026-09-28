import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * activity_search / activity_entity_history は、データの変更の控え change_log（DBトリガーが全変更を記録する表）を読む。
 * 以前は存在しない表 activity_log を読んでいて、必ず失敗していた。
 *
 * - 見せるのは、プロジェクトに属する表（ALLOWED_ACTIVITY_ENTITY_TABLES）の行だけ。
 *   組織の請求・APIキー・招待・プロフィールなどの控えは CLI からは見せない（運営画面だけ）
 * - activity_search はそのプロジェクト（space_id）に絞る
 * - activity_entity_history は組織に絞り、鍵が見られるプロジェクトが決まっていればそこに絞る
 */

type Call = [string, ...unknown[]]
let calls: Call[] = []
let fromTable: string | null = null
let queryResponse: { data: unknown; error: unknown } = { data: [], error: null }
let ctx: Record<string, unknown> = { orgId: 'org-1', allowedSpaceIds: null }

function chain() {
  const obj: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) {
    obj[m] = (...args: unknown[]) => {
      calls.push([m, ...args])
      return obj
    }
  }
  obj.then = (resolve: (v: unknown) => void) => resolve(queryResponse)
  return obj
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
      fromTable = table
      return chain()
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx }),
  checkAuthOrg: async () => ({ ctx }),
}))
vi.mock('../config.js', () => ({ config: { actorId: 'actor-1' } }))

const { activitySearch, activityEntityHistory, activityTools, ALLOWED_ACTIVITY_ENTITY_TABLES } = await import('./activity.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const ROW = '00000000-0000-0000-0000-00000000aaaa'
const ACTOR = '00000000-0000-0000-0000-00000000bbbb'

beforeEach(() => {
  calls = []
  fromTable = null
  queryResponse = { data: [], error: null }
  ctx = { orgId: 'org-1', allowedSpaceIds: null }
})

describe('activity_search — change_log を読む', () => {
  it('change_log を、そのプロジェクト・見せてよい表に絞って新しい順に読む', async () => {
    await activitySearch({ spaceId: SPACE, limit: 20 })

    expect(fromTable).toBe('change_log')
    expect(calls).toContainEqual(['eq', 'space_id', SPACE])
    expect(calls).toContainEqual(['eq', 'org_id', 'org-1'])
    expect(calls).toContainEqual(['in', 'table_name', [...ALLOWED_ACTIVITY_ENTITY_TABLES]])
    expect(calls).toContainEqual(['order', 'id', { ascending: false }])
    expect(calls).toContainEqual(['limit', 20])
  })

  it('絞り込み: 表・行・操作した人・操作の種類・期間を change_log の列に対応させる', async () => {
    await activitySearch({
      spaceId: SPACE,
      entityTable: 'wiki_pages',
      entityId: ROW,
      actorId: ACTOR,
      action: 'delete',
      from: '2026-09-26T00:00:00+09:00',
      to: '2026-09-26T23:59:59+09:00',
      limit: 100,
    })

    expect(calls).toContainEqual(['eq', 'table_name', 'wiki_pages'])
    expect(calls).toContainEqual(['eq', 'row_pk->>id', ROW])
    expect(calls).toContainEqual(['eq', 'actor_user_id', ACTOR])
    expect(calls).toContainEqual(['eq', 'op', 'D'])
    expect(calls).toContainEqual(['gte', 'occurred_at', '2026-09-26T00:00:00+09:00'])
    expect(calls).toContainEqual(['lte', 'occurred_at', '2026-09-26T23:59:59+09:00'])
  })

  it('操作の種類は insert/update/delete（I/U/D も可）。それ以外は 400', async () => {
    await activitySearch({ spaceId: SPACE, action: 'insert', limit: 10 })
    expect(calls).toContainEqual(['eq', 'op', 'I'])

    const err = await activitySearch({ spaceId: SPACE, action: 'created', limit: 10 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })

  it('見せない表（APIキー・請求など）を指定したら 400', async () => {
    const err = await activitySearch({ spaceId: SPACE, entityTable: 'api_keys', limit: 10 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(fromTable).toBeNull()
  })

  it('結果に action（insert/update/delete）を添えて返す', async () => {
    queryResponse = { data: [{ id: 1, op: 'D', table_name: 'wiki_pages' }], error: null }
    const rows = await activitySearch({ spaceId: SPACE, limit: 10 })
    expect(rows[0]).toMatchObject({ op: 'D', action: 'delete' })
  })
})

describe('activity_entity_history — change_log を読む', () => {
  it('組織と表・行で絞る', async () => {
    await activityEntityHistory({ entityTable: 'tasks', entityId: ROW, limit: 50 })

    expect(fromTable).toBe('change_log')
    expect(calls).toContainEqual(['eq', 'org_id', 'org-1'])
    expect(calls).toContainEqual(['eq', 'table_name', 'tasks'])
    expect(calls).toContainEqual(['eq', 'row_pk->>id', ROW])
    expect(calls.filter(([m]) => m === 'in')).toEqual([])
  })

  it('鍵の見られるプロジェクトが決まっていれば、そこに絞る', async () => {
    ctx = { orgId: 'org-1', allowedSpaceIds: [SPACE] }
    await activityEntityHistory({ entityTable: 'tasks', entityId: ROW, limit: 50 })
    expect(calls).toContainEqual(['in', 'space_id', [SPACE]])
  })

  it('見せない表を指定したら 400', async () => {
    const err = await activityEntityHistory({ entityTable: 'org_billing', entityId: ROW, limit: 50 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })
})

describe('activity_log（手書きの記録）は廃止', () => {
  it('道具の一覧に activity_log が無い（変更はDBが自動で記録する）', () => {
    expect(activityTools.map(t => t.name)).not.toContain('activity_log')
  })
})
