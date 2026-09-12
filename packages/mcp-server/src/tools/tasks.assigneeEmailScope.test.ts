import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_update の assigneeEmail は、担当者ID・招待IDの直接指定と同じ範囲
 * （そのプロジェクトのメンバー・そのプロジェクトの未受諾・期限内の招待）で解決する。
 */

const updates: Record<string, unknown>[] = []
let spaceMembers: { user_id: string }[] = []
let inviteRow: { id: string } | null = null
let authUsers: { id: string; email: string }[] = []

function tableChain(table: string) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gt']) c[m] = () => c
  c.update = (p: Record<string, unknown>) => {
    updates.push(p)
    return c
  }
  c.maybeSingle = async () => ({ data: table === 'invites' ? inviteRow : null, error: null })
  c.single = async () => ({
    data: table === 'spaces' ? { org_id: 'org-1' } : { id: 'task-1', ...(updates.at(-1) ?? {}) },
    error: null,
  })
  c.then = (resolve: (v: unknown) => void) =>
    resolve({ data: table === 'space_memberships' ? spaceMembers : [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (t: string) => tableChain(t),
    auth: { admin: { listUsers: async () => ({ data: { users: authUsers }, error: null }) } },
  }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskUpdate } = await import('./tasks.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  updates.length = 0
  spaceMembers = []
  inviteRow = null
  authUsers = []
})

describe('task_update — assigneeEmail もプロジェクトのメンバーの範囲で解決する', () => {
  it('このプロジェクトのメンバーなら本人を担当にする', async () => {
    spaceMembers = [{ user_id: 'user-9' }]
    authUsers = [{ id: 'user-9', email: 'miyata@example.com' }]

    await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeEmail: 'miyata@example.com' })

    expect(updates[0]).toMatchObject({ assignee_id: 'user-9', assignee_invite_id: null })
  })

  it('別のプロジェクトのメンバー（このプロジェクトのメンバーではない）は本人を担当にできない', async () => {
    spaceMembers = [] // 組織にはいるが、このプロジェクトのメンバーではない想定
    authUsers = [{ id: 'user-9', email: 'miyata@example.com' }]

    await expect(taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeEmail: 'miyata@example.com' })).rejects.toThrow(
      /先に招待/
    )
  })
})
