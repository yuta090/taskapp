import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_update が DB に断られたときの返し方。
 * レビューが未承認・仕様が未決定のタスクを完了にしようとすると、DB（enforce_review_gate）が check_violation で止める。
 * 以前は理由を捨てて「タスク更新に失敗しました」（500）にしており、CLI / AI は何を直せばよいか分からなかった（2026-09-12）。
 * 止めた理由は決まった文言で秘密を含まないので、409 で返す。それ以外の DB エラーは中身を出さない。
 */
let dbError: { code: string; message: string } | null = null
const chain = {
  update: () => chain,
  eq: () => chain,
  select: () => chain,
  single: async () => ({ data: dbError ? null : { id: 't-1' }, error: dbError }),
}
vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: () => chain }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskUpdate } = await import('./tasks.js')

const toDone = {
  spaceId: '00000000-0000-0000-0000-000000000010',
  taskId: '00000000-0000-0000-0000-000000000001',
  status: 'done' as const,
}

beforeEach(() => {
  dbError = null
})

describe('task_update が DB に断られたとき', () => {
  it('レビュー未承認で止められたら、理由付きの 409 にする', async () => {
    dbError = { code: '23514', message: 'Cannot complete task: review is not approved' }

    const err = await taskUpdate(toDone).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toMatch(/承認/)
  })

  it('仕様が未決定で止められたら、理由付きの 409 にする', async () => {
    dbError = { code: '23514', message: 'Cannot complete task: spec decision is not made' }

    const err = await taskUpdate(toDone).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toMatch(/決定/)
  })

  it('それ以外の DB エラーは、中身を出さない従来のエラーのまま', async () => {
    dbError = { code: '23505', message: 'duplicate key value violates unique constraint "secret_idx"' }

    const err = await taskUpdate(toDone).catch((e: unknown) => e)
    expect((err as Error).name).not.toBe('ToolUserError')
    expect((err as Error).message).toBe('タスク更新に失敗しました')
  })
})
