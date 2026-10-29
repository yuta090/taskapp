import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_comment_add / task_comment_list。
 * 画面のタスク詳細のコメント欄（task_comments）にそのまま出る形で書く。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'
const ORG = '00000000-0000-0000-0000-0000000000aa'

let keyUserId: string | null = 'user-1'
let allowed = true
let taskRow: { id: string; org_id: string } | null = { id: TASK, org_id: ORG }
let insertedRows: Record<string, unknown>[] = []
let listRows: Record<string, unknown>[] = []
let profileError: { code: string; message: string } | null = null
let listCalls: Array<[string, ...unknown[]]> = []

function chain(table: string) {
  const c: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    if (table === 'task_comments') listCalls.push([name, ...args])
    return c
  }
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[m] = record(m)
  c.insert = (row: Record<string, unknown>) => {
    insertedRows.push(row)
    c._inserted = row
    return c
  }
  c.single = async () => {
    if (table === 'tasks') {
      return taskRow
        ? { data: taskRow, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    }
    if (table === 'task_comments') return { data: { id: 'c-1', ...(c._inserted as object) }, error: null }
    return { data: null, error: null }
  }
  c.then = (resolve: (v: unknown) => void) => {
    if (table === 'task_comments') return resolve({ data: listRows, error: null })
    if (table === 'profiles') {
      return resolve(
        profileError
          ? { data: null, error: profileError }
          : { data: [{ id: 'user-1', display_name: '山田' }], error: null }
      )
    }
    return resolve({ data: [], error: null })
  }
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({
    keyId: 'k',
    userId: keyUserId,
    orgId: ORG,
    scope: 'org',
    allowedSpaceIds: null,
    allowedActions: ['read', 'write'],
  }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () =>
    allowed ? { allowed: true, role: 'admin', reason: 'ok' } : { allowed: false, reason: 'write 権限がありません' },
}))

const { taskCommentAdd, taskCommentList } = await import('./taskComments.js')

beforeEach(() => {
  keyUserId = 'user-1'
  allowed = true
  taskRow = { id: TASK, org_id: ORG }
  insertedRows = []
  listRows = []
  profileError = null
  listCalls = []
})

describe('task_comment_add', () => {
  it('鍵の持ち主・タスクの org_id・既定 internal で insert し、link を返す', async () => {
    const res = await taskCommentAdd({ spaceId: SPACE, taskId: TASK, body: 'こんにちは', visibility: 'internal' })

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({
      org_id: ORG,
      space_id: SPACE,
      task_id: TASK,
      actor_id: 'user-1',
      body: 'こんにちは',
      visibility: 'internal',
      reply_to_id: null,
      mention_user_ids: [],
    })
    expect(res.link).toBe(`/${ORG}/project/${SPACE}?task=${TASK}`)
  })

  it('schema の既定は internal', async () => {
    const { taskCommentAddSchema } = await import('./taskComments.js')
    expect(taskCommentAddSchema.parse({ spaceId: SPACE, taskId: TASK, body: 'x' }).visibility).toBe('internal')
  })

  it('別 space のタスク（見つからない）なら insert しない', async () => {
    taskRow = null

    const err = await taskCommentAdd({ spaceId: SPACE, taskId: TASK, body: 'x', visibility: 'internal' }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).toContain('タスクが見つかりません')
    expect(insertedRows).toHaveLength(0)
  })

  it('userId の無い鍵は 400 で insert しない', async () => {
    keyUserId = null

    const err = await taskCommentAdd({ spaceId: SPACE, taskId: TASK, body: 'x', visibility: 'internal' }).catch(
      (e: unknown) => e
    )

    expect((err as { status?: number }).status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })

  it('write 権限なしなら insert しない', async () => {
    allowed = false

    const err = await taskCommentAdd({ spaceId: SPACE, taskId: TASK, body: 'x', visibility: 'internal' }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).toContain('権限エラー')
    expect(insertedRows).toHaveLength(0)
  })
})

describe('task_comment_list', () => {
  it('消していないコメントを古い順で返し、actor_name を付ける', async () => {
    listRows = [{ id: 'c-1', actor_id: 'user-1', body: 'a' }]

    const res = await taskCommentList({ spaceId: SPACE, taskId: TASK, limit: 50 })

    expect(res).toEqual([{ id: 'c-1', actor_id: 'user-1', body: 'a', actor_name: '山田' }])
    expect(listCalls).toContainEqual(['is', 'deleted_at', null])
    expect(listCalls).toContainEqual(['order', 'created_at', { ascending: true }])
    expect(listCalls).toContainEqual(['limit', 50])
  })

  it('名前の取得に失敗しても名前なしで返す', async () => {
    listRows = [{ id: 'c-1', actor_id: 'user-1', body: 'a' }]
    profileError = { code: '42501', message: 'permission denied' }

    const res = await taskCommentList({ spaceId: SPACE, taskId: TASK, limit: 50 })

    expect(res).toHaveLength(1)
    expect(res[0].body).toBe('a')
    expect(res[0].actor_name).toBeUndefined()
  })
})
