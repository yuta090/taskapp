import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 実績工数(actualHours)は tasks.actual_hours（旧列。C3で削除予定のつなぎ経由）ではなく、
 * 社内専用の別表 task_internal_metrics（task_id が主キー・tasks と1:1）へ書く。
 */

const tasksUpdates: Record<string, unknown>[] = []
const metricsUpserts: Array<{ values: Record<string, unknown>; options: Record<string, unknown> }> = []

const tasksChain = {
  update: (payload: Record<string, unknown>) => {
    tasksUpdates.push(payload)
    return tasksChain
  },
  eq: () => tasksChain,
  select: () => tasksChain,
  single: async () => ({ data: { id: 't-1', actual_hours: null }, error: null }),
}

const metricsChain = {
  upsert: (values: Record<string, unknown>, options: Record<string, unknown>) => {
    metricsUpserts.push({ values, options })
    return Promise.resolve({ error: null })
  },
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => (table === 'task_internal_metrics' ? metricsChain : tasksChain),
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
  tasksUpdates.length = 0
  metricsUpserts.length = 0
})

describe('task_update — actualHours は task_internal_metrics へ書く', () => {
  it('actualHours だけの更新は tasks を更新せず、task_internal_metrics へ upsert する', async () => {
    const result = await taskUpdate({ spaceId: SPACE, taskId: TASK, actualHours: 12.5 })

    expect(tasksUpdates).toHaveLength(0)
    expect(metricsUpserts).toEqual([
      { values: { task_id: TASK, actual_hours: 12.5 }, options: { onConflict: 'task_id' } },
    ])
    expect(result.actual_hours).toBe(12.5)
  })

  it('actualHours を null にする更新も upsert する（行は残す）', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, actualHours: null })

    expect(metricsUpserts).toEqual([
      { values: { task_id: TASK, actual_hours: null }, options: { onConflict: 'task_id' } },
    ])
  })

  it('actualHours と他の列を同時に更新すると、tasks の更新と task_internal_metrics の upsert が両方走る', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, title: '新タイトル', actualHours: 3 })

    expect(tasksUpdates).toHaveLength(1)
    expect(tasksUpdates[0]).toMatchObject({ title: '新タイトル' })
    expect(tasksUpdates[0]).not.toHaveProperty('actual_hours')
    expect(metricsUpserts).toEqual([
      { values: { task_id: TASK, actual_hours: 3 }, options: { onConflict: 'task_id' } },
    ])
  })

  it('actualHours を渡さない更新は task_internal_metrics に触らない', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, title: '新タイトル' })

    expect(metricsUpserts).toHaveLength(0)
  })
})
