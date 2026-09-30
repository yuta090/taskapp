import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_list / task_get / task_list_my / task_stale が DB に断られた理由を、
 * cause に残さず「〜に失敗しました」に握り潰していた箇所の回帰テスト。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  const self = () => obj
  for (const m of ['select', 'eq', 'in', 'is', 'gt', 'order', 'limit', 'range', 'update', 'insert', 'neq', 'lt', 'or']) {
    obj[m] = self
  }
  obj.single = async () => result
  obj.maybeSingle = async () => result
  obj.then = (resolve: (v: unknown) => void) => resolve(result)
  return obj
}

let taskOwnersResult: { data: unknown; error: unknown } = { data: [], error: null }
let membershipsResult: { data: unknown; error: unknown } = { data: [], error: null }

// テストごとに 'tasks' テーブルの結果を差し替える（task_list/task_get/task_stale はいずれも
// 'tasks' を1回だけ叩く単純な形なので、共通の変数で足りる）
let tasksTableResult: { data: unknown; error: unknown } = { data: [], error: null }

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'tasks') return chain(tasksTableResult)
      if (table === 'task_owners') return chain(taskOwnersResult)
      if (table === 'space_memberships') return chain(membershipsResult)
      return chain({ data: null, error: null })
    },
  }),
}))
let ctxScope: 'org' | 'user' = 'org'
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: ctxScope, allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskList, taskGet, taskListMy, taskStale } = await import('./tasks.js')

beforeEach(() => {
  tasksTableResult = { data: [], error: null }
  taskOwnersResult = { data: [], error: null }
  membershipsResult = { data: [], error: null }
  ctxScope = 'org'
})

describe('task_list — 断られた理由の cause', () => {
  it('cause に元のDBエラーを残す', async () => {
    tasksTableResult = { data: null, error: { code: '42501', message: 'permission denied for table tasks' } }

    const err = (await taskList({ spaceId: SPACE, limit: 50, offset: 0 }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tasksTableResult.error)
  })
})

describe('task_get — 断られた理由の cause', () => {
  it('タスク本体が0件（PGRST116）は ToolUserError(404)、cause も残す', async () => {
    tasksTableResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await taskGet({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('タスクが見つかりません')
    expect(err.cause).toEqual(tasksTableResult.error)
  })

  it('担当者(task_owners)の取得に失敗しても、cause に元のDBエラーを残す', async () => {
    tasksTableResult = { data: { id: TASK, org_id: 'org-1' }, error: null }
    taskOwnersResult = { data: null, error: { code: '42501', message: 'permission denied for table task_owners' } }

    const err = (await taskGet({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(taskOwnersResult.error)
  })
})

describe('task_list_my — スペース一覧取得の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    ctxScope = 'user'
    membershipsResult = { data: null, error: { code: '42501', message: 'permission denied for table space_memberships' } }

    const err = (await taskListMy({ limit: 50, offset: 0 }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(membershipsResult.error)
  })
})

describe('task_stale — 断られた理由の cause', () => {
  it('cause に元のDBエラーを残す', async () => {
    tasksTableResult = { data: null, error: { code: '42501', message: 'permission denied for table tasks' } }

    const err = (await taskStale({ spaceId: SPACE, staleDays: 7, limit: 50 }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tasksTableResult.error)
  })
})
