import { describe, it, expect, vi } from 'vitest'

/**
 * task_list_my は個人用の鍵（scope=user）専用。プロジェクト用の鍵で呼ぶと断るが、
 * その理由が 500「Internal server error」に化けて CLI に見えなかった（2026-09-12）。403 と理由で返す。
 */
vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: () => ({}) }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'user-1', orgId: 'org-1', scope: 'space', allowedSpaceIds: null, allowedActions: ['read'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskListMy, taskListMySchema } = await import('./tasks.js')

describe('task_list_my の鍵の種類', () => {
  it('個人用でない鍵では、理由付きの 403 にする', async () => {
    const err = await taskListMy(taskListMySchema.parse({})).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
    expect((err as Error).message).toMatch(/scope=user/)
  })
})
