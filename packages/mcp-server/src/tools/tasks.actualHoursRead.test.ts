import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 実績工数(actual_hours)は社内専用の別表 task_internal_metrics（task_id 主キー・
 * tasks と1:1）に移した。task_get / task_list / task_list_my は tasks.actual_hours
 * （旧列。C3で削除予定）ではなく、埋め込みで読んだ新表の値を actual_hours として返す。
 */

let taskRow: Record<string, unknown> = {
  id: 't-1',
  space_id: '00000000-0000-0000-0000-000000000010',
  actual_hours: 999, // 旧列(つなぎ)の値。埋め込みの値を優先する
  task_internal_metrics: { actual_hours: 12.5 },
}

const chain: Record<string, unknown> = {}
chain.select = () => chain
chain.eq = () => chain
chain.order = () => chain
chain.range = () => chain
chain.single = async () => ({ data: taskRow, error: null })
chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
  resolve({ data: [taskRow], error: null })

const MEMBERSHIPS = [
  { space_id: '00000000-0000-0000-0000-000000000010', spaces: { id: '00000000-0000-0000-0000-000000000010', name: 'Test Space' } },
]

function fromMock(table: string) {
  if (table === 'task_owners') {
    return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }
  }
  if (table === 'space_memberships') {
    return { select: () => ({ eq: async () => ({ data: MEMBERSHIPS, error: null }) }) }
  }
  return chain
}

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: fromMock }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'u1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskGet, taskList } = await import('./tasks.js')

beforeEach(() => {
  taskRow = {
    id: 't-1',
    space_id: '00000000-0000-0000-0000-000000000010',
    actual_hours: 999,
    task_internal_metrics: { actual_hours: 12.5 },
  }
})

const SPACE = '00000000-0000-0000-0000-000000000010'

describe('task_get / task_list — actual_hours は task_internal_metrics の埋め込みから読む', () => {
  it('task_get: 埋め込みの値(12.5)を actual_hours として返し、埋め込み自体は残さない', async () => {
    const result = await taskGet({ spaceId: SPACE, taskId: 't-1' })
    expect(result.task.actual_hours).toBe(12.5)
    expect((result.task as unknown as { task_internal_metrics?: unknown }).task_internal_metrics).toBeUndefined()
  })

  it('task_get: 埋め込みが無い(行が無い)タスクは actual_hours が null になる', async () => {
    taskRow = { ...taskRow, task_internal_metrics: null }
    const result = await taskGet({ spaceId: SPACE, taskId: 't-1' })
    expect(result.task.actual_hours).toBeNull()
  })

  it('task_list: 一覧の各行も埋め込みの値を actual_hours として返す', async () => {
    const result = await taskList({ spaceId: SPACE, limit: 100, offset: 0 })
    expect(result[0].actual_hours).toBe(12.5)
  })
})
