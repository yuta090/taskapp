import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_list / task_list_my の --offset。limit は既に上限100で、200件あるプロジェクトでも
 * 「続きから取る」手段が無く全件取得できなかった。offset を足して
 * .range(offset, offset + limit - 1) でページングできるようにする。
 */
const rangeCalls: Array<[number, number]> = []
const MEMBERSHIPS = [{ space_id: 'space-1', spaces: { id: 'space-1', name: 'Test Space' } }]

type Ctx = {
  keyId: string
  userId: string | null
  orgId: string
  scope: 'org' | 'user'
  allowedSpaceIds: string[] | null
  allowedActions: string[]
}
let ctx: Ctx = {
  keyId: 'k',
  userId: 'actor-1',
  orgId: 'org-1',
  scope: 'org',
  allowedSpaceIds: null,
  allowedActions: ['read', 'write'],
}

function tasksChain() {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.order = () => chain
  chain.range = (from: number, to: number) => {
    rangeCalls.push([from, to])
    return chain
  }
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null })
  return chain
}

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
  getAuthContext: () => ctx,
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskList, taskListSchema, taskListMy, taskListMySchema } = await import('./tasks.js')

const SPACE = '00000000-0000-0000-0000-000000000010'

describe('task_list --offset', () => {
  beforeEach(() => {
    rangeCalls.length = 0
    ctx = { keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }
  })

  it('offset 省略時は先頭から limit 件（range(0, limit-1)）', async () => {
    const params = taskListSchema.parse({ spaceId: SPACE, limit: 100 })
    expect(params.offset).toBe(0)
    await taskList(params)
    expect(rangeCalls).toEqual([[0, 99]])
  })

  it('offset=100・limit=100 なら 101 件目から取る（range(100, 199)）', async () => {
    const params = taskListSchema.parse({ spaceId: SPACE, limit: 100, offset: 100 })
    await taskList(params)
    expect(rangeCalls).toEqual([[100, 199]])
  })

  it('負の offset は拒否する', () => {
    expect(taskListSchema.safeParse({ spaceId: SPACE, offset: -1 }).success).toBe(false)
  })

  it('小数の offset は拒否する', () => {
    expect(taskListSchema.safeParse({ spaceId: SPACE, offset: 1.5 }).success).toBe(false)
  })
})

describe('task_list_my --offset', () => {
  beforeEach(() => {
    rangeCalls.length = 0
    ctx = { keyId: 'k', userId: 'u1', orgId: 'org-1', scope: 'user', allowedSpaceIds: null, allowedActions: ['read'] }
  })

  it('offset 省略時は先頭から limit 件（range(0, limit-1)）', async () => {
    const params = taskListMySchema.parse({ limit: 50 })
    expect(params.offset).toBe(0)
    await taskListMy(params)
    expect(rangeCalls).toEqual([[0, 49]])
  })

  it('offset=50・limit=50 なら 51 件目から取る（range(50, 99)）', async () => {
    const params = taskListMySchema.parse({ limit: 50, offset: 50 })
    await taskListMy(params)
    expect(rangeCalls).toEqual([[50, 99]])
  })

  it('負の offset は拒否する', () => {
    expect(taskListMySchema.safeParse({ offset: -1 }).success).toBe(false)
  })
})
