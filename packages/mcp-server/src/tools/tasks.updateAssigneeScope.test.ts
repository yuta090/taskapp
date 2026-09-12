import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_update の担当者(assigneeId)・招待中の担当者(assigneeInviteId)は、
 * 画面の担当者選択肢と同じ範囲（そのプロジェクトのメンバー・そのプロジェクトの
 * 未受諾・期限内の招待）に限る。
 */

const tasksUpdates: Record<string, unknown>[] = []
let spaceMemberIds: string[] = []
let inviteIds: string[] = []

function tasksChain() {
  const chain: Record<string, unknown> = {
    update: (payload: Record<string, unknown>) => {
      tasksUpdates.push(payload)
      return chain
    },
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { id: TASK }, error: null }),
  }
  return chain
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'space_memberships') {
        return {
          select: () => ({
            eq: () => ({
              in: (_col: string, ids: string[]) =>
                Promise.resolve({
                  data: ids.filter((id) => spaceMemberIds.includes(id)).map((id) => ({ user_id: id })),
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === 'invites') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                gt: () => ({
                  in: (_col: string, ids: string[]) =>
                    Promise.resolve({
                      data: ids.filter((id) => inviteIds.includes(id)).map((id) => ({ id })),
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }
      }
      return tasksChain()
    },
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
const MEMBER = '00000000-0000-0000-0000-0000000000a1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000ff'
const INVITE = '00000000-0000-0000-0000-00000000bbbb'
const OTHER_INVITE = '00000000-0000-0000-0000-00000000cccc'

beforeEach(() => {
  tasksUpdates.length = 0
  spaceMemberIds = [MEMBER]
  inviteIds = [INVITE]
})

describe('task_update — assigneeId はプロジェクトのメンバーに限る', () => {
  it('メンバーを指定すると更新する', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeId: MEMBER })
    expect(tasksUpdates[0]).toMatchObject({ assignee_id: MEMBER })
  })

  it('メンバーでない人を指定すると拒否する', async () => {
    const err = await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeId: OUTSIDER }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(tasksUpdates).toHaveLength(0)
  })

  it('null(解除)は確認しない', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeId: null })
    expect(tasksUpdates[0]).toMatchObject({ assignee_id: null })
  })
})

describe('task_update — assigneeInviteId はプロジェクトの未受諾・期限内の招待に限る', () => {
  it('このプロジェクトの招待を指定すると更新する', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeInviteId: INVITE })
    expect(tasksUpdates[0]).toMatchObject({ assignee_invite_id: INVITE })
  })

  it('別のプロジェクトの招待（または存在しない・受諾済み・期限切れ）を指定すると拒否する', async () => {
    const err = await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeInviteId: OTHER_INVITE }).catch(
      (e: unknown) => e
    )
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(tasksUpdates).toHaveLength(0)
  })

  it('null(解除)は確認しない', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, assigneeInviteId: null })
    expect(tasksUpdates[0]).toMatchObject({ assignee_invite_id: null })
  })
})
