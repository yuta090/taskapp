import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_create が DB に断られた理由を、cause に残さず握り潰していた箇所の回帰テスト。
 *   - スペース取得: 0件（PGRST116）は ToolUserError(404)、それ以外は一般Errorのまま。どちらも cause を残す
 *   - 担当者(task_owners)の登録失敗: 一般Errorのまま、cause を残す
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'
const OWNER = '00000000-0000-0000-0000-000000000099'

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  const self = () => obj
  for (const m of ['select', 'eq', 'in', 'is', 'gt', 'order', 'limit', 'range', 'update', 'neq', 'lt', 'or']) {
    obj[m] = self
  }
  obj.insert = () => obj
  obj.single = async () => result
  obj.maybeSingle = async () => result
  obj.then = (resolve: (v: unknown) => void) => resolve(result)
  return obj
}

let spaceResult: { data: unknown; error: unknown } = { data: { org_id: 'org-1' }, error: null }
let taskInsertResult: { data: unknown; error: unknown } = { data: { id: TASK, org_id: 'org-1' }, error: null }
let membershipResult: { data: unknown; error: unknown } = { data: [{ user_id: OWNER, role: 'admin' }], error: null }
let ownersInsertResult: { data: unknown; error: unknown } = { data: [], error: null }

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return chain(spaceResult)
      if (table === 'tasks') return chain(taskInsertResult)
      if (table === 'space_memberships') return chain(membershipResult)
      if (table === 'task_owners') return chain(ownersInsertResult)
      return chain({ data: null, error: null })
    },
  }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskCreate } = await import('./tasks.js')

const base = {
  spaceId: SPACE,
  title: 'T',
  type: 'task' as const,
  ball: 'internal' as const,
  origin: 'internal' as const,
  clientScope: 'deliverable' as const,
  clientOwnerIds: [],
  internalOwnerIds: [],
}

beforeEach(() => {
  spaceResult = { data: { org_id: 'org-1' }, error: null }
  taskInsertResult = { data: { id: TASK, org_id: 'org-1' }, error: null }
  membershipResult = { data: [{ user_id: OWNER, role: 'admin' }], error: null }
  ownersInsertResult = { data: [], error: null }
})

describe('task_create — スペース取得の断り方', () => {
  it('0件（PGRST116）は ToolUserError(404)、cause に元のDBエラーを残す', async () => {
    spaceResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await taskCreate(base).catch((e: unknown) => e)) as Error & { status?: number; cause?: unknown }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('スペースが見つかりません')
    expect(err.cause).toEqual(spaceResult.error)
  })

  it('それ以外は一般のErrorのまま、cause に元のDBエラーを残す', async () => {
    spaceResult = { data: null, error: { code: '42501', message: 'permission denied for table spaces' } }

    const err = (await taskCreate(base).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(spaceResult.error)
  })
})

describe('task_create — 担当者(task_owners)登録の断り方', () => {
  it('登録に失敗したら、cause に元のDBエラーを残す', async () => {
    ownersInsertResult = { data: null, error: { code: '42501', message: 'permission denied for table task_owners' } }

    const err = (await taskCreate({ ...base, internalOwnerIds: [OWNER] }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(ownersInsertResult.error)
  })
})
