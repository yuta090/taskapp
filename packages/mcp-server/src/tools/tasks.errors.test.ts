import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_create（作成失敗）・task_update の assigneeEmail 解決（メンバー確認・招待確認）は、
 * 見覚えのないDBの理由を、生の文言を出さない一般のエラーにする。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'

let taskInsertError: { code: string; message: string } | null = null
let memberError: { code: string; message: string } | null = null
let inviteError: { code: string; message: string } | null = null
let listUsersError: { code: string; message: string } | null = null

function chain(table: string) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gt']) c[m] = () => c
  c.insert = () => c
  c.update = () => c
  c.single = async () => {
    if (table === 'spaces') return { data: { org_id: 'org-1' }, error: null }
    if (table === 'tasks') return { data: { id: TASK }, error: taskInsertError }
    return { data: null, error: null }
  }
  c.maybeSingle = async () => ({ data: null, error: inviteError })
  c.then = (resolve: (v: unknown) => void) =>
    resolve(table === 'space_memberships' ? { data: [], error: memberError } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => chain(table),
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: listUsersError }) } },
  }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskCreate, taskUpdate } = await import('./tasks.js')

const base = { spaceId: SPACE, title: 'T', type: 'task' as const, ball: 'internal' as const, origin: 'internal' as const, clientScope: 'deliverable' as const, clientOwnerIds: [], internalOwnerIds: [] }

beforeEach(() => {
  taskInsertError = null
  memberError = null
  inviteError = null
  listUsersError = null
})

describe('task_create — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('作成に失敗', async () => {
    taskInsertError = { code: '42501', message: 'permission denied for table tasks' }

    const err = await taskCreate(base).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('task_update（assigneeEmail解決） — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('メンバーの確認に失敗', async () => {
    memberError = { code: '42501', message: 'permission denied for table space_memberships' }

    const err = await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeEmail: 'x@example.com' }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('招待の確認に失敗', async () => {
    inviteError = { code: '42501', message: 'permission denied for table invites' }

    const err = await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeEmail: 'x@example.com' }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('ユーザー情報(listUsers)の取得に失敗', async () => {
    listUsersError = { code: 'unknown', message: 'auth admin listUsers failed unexpectedly' }

    const err = await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeEmail: 'x@example.com' }).catch(
      (e: unknown) => e
    )

    expect((err as Error).message).not.toContain('unexpectedly')
  })
})
