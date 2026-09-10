import { describe, it, expect, vi } from 'vitest'

/**
 * tasks.short_id（サービス全体の通し番号）を CLI/API 出力に `number: 'TP-42'` として足す。
 * GitHub連携が PR タイトルの `TP-番号` からタスクを見つける仕組みがあるが、番号を確認する
 * 手段が CLI に無かったため追加する。
 *
 * CLI の表表示(packages/cli/src/output.ts の printTable)は「先頭8列」しか出さないため、
 * number を各タスク行オブジェクトの**先頭キー**にする（末尾だと8列目からはみ出て見えない）。
 */

const TASK_ROW = {
  id: 't-1',
  org_id: 'org-1',
  space_id: 'space-1',
  milestone_id: null,
  parent_task_id: null,
  title: 'サンプルタスク',
  description: null,
  status: 'todo',
  priority: null,
  assignee_id: null,
  start_date: null,
  due_date: '2026-09-10',
  ball: 'internal',
  origin: 'internal',
  type: 'task',
  spec_path: null,
  decision_state: null,
  client_scope: 'internal',
  actual_hours: null,
  short_id: 42,
  created_at: '2026-09-01T00:00:00',
  updated_at: '2026-09-01T00:00:00',
}

function tasksChain(rows: unknown[] = [TASK_ROW]) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.order = () => chain
  chain.range = () => chain
  chain.single = async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } })
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null })
  return chain
}

const MEMBERSHIPS = [{ space_id: 'space-1', spaces: { id: 'space-1', name: 'Test Space' } }]
function membershipsChain() {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: MEMBERSHIPS, error: null })
  return chain
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => (table === 'space_memberships' ? membershipsChain() : tasksChain()),
  }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({
    keyId: 'k',
    userId: 'actor-1',
    orgId: 'org-1',
    scope: 'user',
    allowedSpaceIds: null,
    allowedActions: ['read', 'write'],
  }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskList, taskGet, taskListMy } = await import('./tasks.js')

describe('task_list — number(TP-番号)を先頭キーで足す', () => {
  it('各タスクの先頭キーが number で、値が TP-<short_id> になる', async () => {
    const tasks = await taskList({ spaceId: 'space-1', offset: 0, limit: 20 })
    const task = tasks[0] as unknown as Record<string, unknown>
    expect(Object.keys(task)[0]).toBe('number')
    expect(task.number).toBe('TP-42')
    // number 以外の値は変わらない
    expect(task.title).toBe('サンプルタスク')
    expect(task.id).toBe('t-1')
  })
})

describe('task_get — number(TP-番号)を先頭キーで足す', () => {
  it('task オブジェクトの先頭キーが number になる', async () => {
    const { task } = await taskGet({ spaceId: 'space-1', taskId: 't-1' })
    const t = task as unknown as Record<string, unknown>
    expect(Object.keys(t)[0]).toBe('number')
    expect(t.number).toBe('TP-42')
  })
})

describe('task_list_my — number(TP-番号)を先頭キーで足す', () => {
  it('各スペースのタスクにも number が先頭キーで付く', async () => {
    const results = await taskListMy({ offset: 0, limit: 20 })
    const task = results[0].tasks[0] as unknown as Record<string, unknown>
    expect(Object.keys(task)[0]).toBe('number')
    expect(task.number).toBe('TP-42')
  })
})
