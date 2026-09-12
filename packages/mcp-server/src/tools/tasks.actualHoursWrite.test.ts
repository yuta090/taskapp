import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 実績工数(actualHours)は tasks.actual_hours（旧列。C3で削除予定のつなぎ経由）ではなく、
 * 社内専用の別表 task_internal_metrics（task_id が主キー・tasks と1:1）へ書く。
 *
 * mcp-server は service role（RLSを通らない）で動くため、actualHours だけの更新
 * （tasks 自体を更新しない経路）でも、書き込み先のタスクが渡された space に
 * 属することを事前に確かめてから upsert する。
 */

const tasksUpdates: Record<string, unknown>[] = []
const metricsUpserts: Array<{ values: Record<string, unknown>; options: Record<string, unknown> }> = []
const spaceChecks: Array<Record<string, unknown>> = []
let taskExistsInSpace = true
let metricsUpsertShouldFail = false

function makeTasksChain() {
  let eqArgs: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {
    update: (payload: Record<string, unknown>) => {
      tasksUpdates.push(payload)
      return chain
    },
    select: () => chain,
    eq: (col: string, val: unknown) => {
      eqArgs = { ...eqArgs, [col]: val }
      return chain
    },
    single: async () => ({ data: { id: TASK, actual_hours: null }, error: null }),
    maybeSingle: async () => {
      spaceChecks.push(eqArgs)
      return { data: taskExistsInSpace ? { id: TASK } : null, error: null }
    },
  }
  return chain
}

const metricsChain = {
  upsert: (values: Record<string, unknown>, options: Record<string, unknown>) => {
    metricsUpserts.push({ values, options })
    return Promise.resolve(
      metricsUpsertShouldFail ? { error: { message: 'boom' } } : { error: null }
    )
  },
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => (table === 'task_internal_metrics' ? metricsChain : makeTasksChain()),
  }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskUpdate } = await import('./tasks.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const OTHER_SPACE = '00000000-0000-0000-0000-000000000099'
const TASK = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  tasksUpdates.length = 0
  metricsUpserts.length = 0
  spaceChecks.length = 0
  taskExistsInSpace = true
  metricsUpsertShouldFail = false
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

  it('別の space のタスク ID では書き込まない（エラーを返す）', async () => {
    taskExistsInSpace = false

    await expect(taskUpdate({ spaceId: OTHER_SPACE, taskId: TASK, actualHours: 5 })).rejects.toThrow()

    expect(metricsUpserts).toHaveLength(0)
    expect(spaceChecks).toEqual([{ id: TASK, space_id: OTHER_SPACE }])
  })

  it('actualHours と他の列を同時に更新するときは、tasks の更新自体が space を絞っているため、別途の存在確認はしない', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, title: '新タイトル', actualHours: 3 })

    // tasks.update().eq('id',...).eq('space_id',...) で既に絞られているため、
    // actualHours 用の追加の存在確認クエリ(maybeSingle)は発行しない
    expect(spaceChecks).toHaveLength(0)
  })

  it('タイトル等の更新後にupsertだけ失敗すると、tasks側は保存済みであることが分かるメッセージにする', async () => {
    metricsUpsertShouldFail = true

    await expect(
      taskUpdate({ spaceId: SPACE, taskId: TASK, title: '新タイトル', actualHours: 3 })
    ).rejects.toThrow('タイトル等は更新できましたが')
  })

  it('actualHoursだけの更新でupsertが失敗したときは、tasks側は変えていない旨のメッセージにする', async () => {
    metricsUpsertShouldFail = true

    await expect(taskUpdate({ spaceId: SPACE, taskId: TASK, actualHours: 3 })).rejects.toThrow(
      '実績工数の更新に失敗しました'
    )
  })
})
