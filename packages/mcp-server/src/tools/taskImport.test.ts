import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_import ハンドラの DB 境界テスト。
 * 純粋ロジック(taskImportPlan)は別テストで押さえているので、ここでは
 *   - dryRun 既定では何も書かない
 *   - エラーが1件でもあれば何も書かない
 *   - 実行時は親→子の順に insert し、担当者(task_owners)も付く
 *   - 認可は 'bulk' で通す
 * だけを検証する。
 */

const inserted: { table: string; rows: Record<string, unknown>[] }[] = []
const authorizeMock = vi.fn(async () => ({ allowed: true, role: 'admin', reason: 'ok' }))

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {
  spaces: [{ id: 'space-1', org_id: 'org-1' }],
  tasks: [{ id: 't-old', title: '既存タスク', space_id: 'space-1' }],
  org_memberships: [
    { org_id: 'org-1', user_id: 'u-taka', role: 'owner' },
    { org_id: 'org-1', user_id: 'u-tanaka', role: 'client' },
  ],
  profiles: [
    { id: 'u-taka', display_name: '高橋' },
    { id: 'u-tanaka', display_name: '田中' },
  ],
  milestones: [{ id: 'm-1', space_id: 'space-1', name: 'フェーズ1' }],
}

function query(table: string) {
  let rows = db[table] ?? []
  const q: Record<string, unknown> = {}
  const chain = () => q
  q.select = chain
  q.order = chain
  q.eq = (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q }
  q.in = (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return q }
  q.range = (from: number, to: number) => { rows = rows.slice(from, to + 1); return q }
  q.single = async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } })
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
  q.insert = (payload: Row[]) => {
    inserted.push({ table, rows: payload })
    return { select: async () => ({ data: payload, error: null }), then: (r: (v: unknown) => void) => r({ data: payload, error: null }) }
  }
  return q
}

const listUsers = vi.fn(async () => ({
  data: { users: [{ id: 'u-taka', email: 'takahashi@example.com' }, { id: 'u-tanaka', email: 'tanaka@example.com' }] },
  error: null,
}))

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: query, auth: { admin: { listUsers } } }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write', 'bulk'] }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: (...args: unknown[]) => authorizeMock(...(args as [])),
}))

const { taskImport } = await import('./taskImport.js')

const CSV = [
  'title,status,ball,client_scope,due_date,assignee,client_owners,parent',
  '子A,todo,internal,internal,2026-09-05,takahashi@example.com,,大項目1',
  '子B,in_review,client,deliverable,2026-09-06,高橋,田中,大項目1',
  '既存タスク,todo,,,,,,',
].join('\n')

beforeEach(() => { inserted.length = 0; authorizeMock.mockClear() })

describe('task_import', () => {
  it('既存タスクの確認は、タイトルをURLに載せず（.in を使わず）ページングで全件引く', async () => {
    const calls: string[] = []
    const origQuery = query
    // 呼ばれたメソッド名を記録する薄いラッパ
    const spyFrom = (table: string) => {
      const q = origQuery(table) as Record<string, unknown>
      if (table === 'tasks') {
        for (const m of ['in', 'range']) {
          const f = q[m] as (...a: unknown[]) => unknown
          q[m] = (...a: unknown[]) => { calls.push(m); return f(...a) }
        }
      }
      return q
    }
    const mod = await import('../supabase/client.js')
    const spy = vi.spyOn(mod, 'getSupabaseClient').mockReturnValue({ from: spyFrom, auth: { admin: { listUsers } } } as never)
    await taskImport({ spaceId: 'space-1', csv: CSV, dryRun: true })
    spy.mockRestore()
    expect(calls).toContain('range')
    expect(calls).not.toContain('in')
  })

  it('dryRun 既定: 計画だけ返し、何も書かない。認可は bulk', async () => {
    const res = await taskImport({ spaceId: 'space-1', csv: CSV, dryRun: true })
    expect(inserted).toEqual([])
    expect(authorizeMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'bulk', toolName: 'task_import' }))
    expect(res).toMatchObject({
      success: true, dryRun: true,
      summary: { rows: 3, toCreate: 3, autoParents: 1, skipped: 1, errors: 0 },
    })
    expect(res.skipped).toEqual([{ line: 4, title: '既存タスク', reason: expect.any(String) }])
    expect(res.preview.map((p) => p.title)).toEqual(['大項目1', '子A', '子B'])
  })

  it('エラーが1件でもあれば実行モードでも何も書かない', async () => {
    const bad = CSV + '\n壊れた行,flying,,,,,,'
    const res = await taskImport({ spaceId: 'space-1', csv: bad, dryRun: false })
    expect(inserted).toEqual([])
    expect(res.success).toBe(false)
    expect(res.errors).toEqual([{ line: 5, title: '壊れた行', message: expect.stringMatching(/status/) }])
  })

  it('実行モード: 親→子の順で tasks を insert し、担当者も付ける', async () => {
    const res = await taskImport({ spaceId: 'space-1', csv: CSV, dryRun: false })
    expect(res.success).toBe(true)
    expect(res.dryRun).toBe(false)

    const taskInserts = inserted.filter((i) => i.table === 'tasks')
    expect(taskInserts).toHaveLength(2) // depth 0 → depth 1
    expect(taskInserts[0].rows.map((r) => r.title)).toEqual(['大項目1'])
    expect(taskInserts[1].rows.map((r) => r.title)).toEqual(['子A', '子B'])
    const parentId = taskInserts[0].rows[0].id
    for (const r of taskInserts[1].rows) {
      expect(r.parent_task_id).toBe(parentId)
      expect(r).toMatchObject({ org_id: 'org-1', space_id: 'space-1', created_by: 'actor-1', type: 'task' })
    }
    const childB = taskInserts[1].rows[1]
    expect(childB).toMatchObject({ status: 'in_review', ball: 'client', client_scope: 'deliverable', assignee_id: 'u-taka', due_date: '2026-09-06' })

    const owners = inserted.find((i) => i.table === 'task_owners')!
    expect(owners.rows).toEqual([
      expect.objectContaining({ task_id: childB.id, side: 'client', user_id: 'u-tanaka' }),
    ])
    expect(res.created.map((c) => c.title)).toEqual(['大項目1', '子A', '子B'])
  })
})
