import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 招待中の人をタスクの担当者にできること（assignee_invite_id）と、
 * メール指定（assigneeEmail）が「参加済みなら本人 / 未承諾なら招待」を選び分けること。
 * 担当者は本人と招待のどちらか一方だけ（DB の tasks_single_assignee_chk）なので、
 * 片方を入れたらもう片方が消えることも固定する。
 */
const updates: Record<string, unknown>[] = []
let inviteRow: { id: string } | null = null
let spaceMembersForEmail: { user_id: string }[] = []
let authUsers: { id: string; email: string }[] = []
// assertUsersAreSpaceMembers / assertInvitesAreInSpace（範囲照合）が見る、このプロジェクトの
// メンバー・有効な招待の一覧
let spaceMemberIds: string[] = []
let validInviteIds: string[] = []

function tableChain(table: string) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gt']) c[m] = () => c
  c.update = (p: Record<string, unknown>) => { updates.push(p); return c }
  c.maybeSingle = async () => ({ data: table === 'invites' ? inviteRow : null, error: null })
  c.single = async () => ({
    data: table === 'spaces' ? { org_id: 'org-1' } : { id: 'task-1', ...(updates.at(-1) ?? {}) },
    error: null,
  })
  c.in = (_col: string, ids: string[]) => {
    if (table === 'space_memberships') {
      return Promise.resolve({ data: ids.filter((id) => spaceMemberIds.includes(id)).map((id) => ({ user_id: id })), error: null })
    }
    if (table === 'invites') {
      return Promise.resolve({ data: ids.filter((id) => validInviteIds.includes(id)).map((id) => ({ id })), error: null })
    }
    return Promise.resolve({ data: [], error: null })
  }
  c.then = (resolve: (v: unknown) => void) =>
    // resolveAssigneeByEmail のメンバー確認は space_memberships を見る（プロジェクトの範囲）
    resolve({ data: table === 'space_memberships' ? spaceMembersForEmail : [], error: null })
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
const S = '00000000-0000-0000-0000-000000000010'
const T = '00000000-0000-0000-0000-00000000t001'.replace(/t/g, 'a')
const INV = '00000000-0000-0000-0000-0000000000b1'

beforeEach(() => {
  updates.length = 0
  inviteRow = null
  spaceMembersForEmail = []
  authUsers = []
  spaceMemberIds = []
  validInviteIds = []
})

describe('招待中の人への割り当て', () => {
  it('招待IDを直接指定すると、招待が担当になり本人側は空になる', async () => {
    validInviteIds = [INV]
    await taskUpdate({ spaceId: S, taskId: T, assigneeInviteId: INV })
    expect(updates[0]).toMatchObject({ assignee_invite_id: INV, assignee_id: null })
  })

  it('招待IDに null を渡すと担当を外す（本人側は触らない）', async () => {
    await taskUpdate({ spaceId: S, taskId: T, assigneeInviteId: null })
    expect(updates[0]).toMatchObject({ assignee_invite_id: null })
    expect(updates[0]).not.toHaveProperty('assignee_id')
  })

  it('本人を指定すると、招待側は空になる', async () => {
    spaceMemberIds = ['00000000-0000-0000-0000-0000000000c1']
    await taskUpdate({ spaceId: S, taskId: T, assigneeId: '00000000-0000-0000-0000-0000000000c1' })
    expect(updates[0]).toMatchObject({ assignee_id: '00000000-0000-0000-0000-0000000000c1', assignee_invite_id: null })
  })

  it('メール指定: 参加済みのメンバーなら本人を担当にする', async () => {
    spaceMembersForEmail = [{ user_id: 'user-9' }]
    authUsers = [{ id: 'user-9', email: 'Miyata@Example.com' }]
    await taskUpdate({ spaceId: S, taskId: T, assigneeEmail: 'miyata@example.com' })
    expect(updates[0]).toMatchObject({ assignee_id: 'user-9', assignee_invite_id: null })
  })

  it('メール指定: まだ承諾していない招待なら、その招待を担当にする', async () => {
    inviteRow = { id: INV }
    await taskUpdate({ spaceId: S, taskId: T, assigneeEmail: 'tabata@example.co.jp' })
    expect(updates[0]).toMatchObject({ assignee_id: null, assignee_invite_id: INV })
  })

  it('メール指定: メンバーにも招待にも無ければ、招待を促すエラー', async () => {
    await expect(taskUpdate({ spaceId: S, taskId: T, assigneeEmail: 'nobody@example.com' })).rejects.toThrow(/先に招待/)
  })
})
