import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * space_create / space_update / space_list / space_get: 見覚えのないDBの理由は、
 * 生の文言を出さない一般のエラーにする。space_getが対象を見つけられない
 * （PGRST116）ときは「見つかりません」のToolUserError(404)にする。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
/** skipCalls: このテーブルへの呼び出しのうち、最初の何回を成功させてからエラーにするか */
type TableConfig = { error?: { code?: string; message: string }; skipCalls?: number }
let tableConfig: Record<string, TableConfig> = {}
const callCount: Record<string, number> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  callCount[table] = (callCount[table] ?? 0) + 1
  const shouldError = !!cfg?.error && callCount[table] > (cfg.skipCalls ?? 0)
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in']) c[m] = () => c
  c.insert = () => c
  c.update = () => c
  c.single = async () =>
    shouldError ? { data: null, error: cfg!.error } : { data: { id: 'space-1', org_id: 'org-1' }, error: null }
  c.then = (resolve: (v: unknown) => void) => resolve(shouldError ? { data: null, error: cfg!.error } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx: {} }),
  checkAuthOrg: async () => ({ ctx: { orgId: 'org-1', userId: 'actor-1' } }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({
    keyId: 'org-key',
    userId: 'actor-1',
    orgId: 'org-1',
    scope: 'org',
    allowedSpaceIds: null,
    allowedActions: ['read', 'write'],
  }),
}))

const { spaceCreate, spaceUpdate, spaceList, spaceGet } = await import('./spaces.js')

beforeEach(() => {
  tableConfig = {}
  for (const k of Object.keys(callCount)) delete callCount[k]
})

describe('space_create — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('作成に失敗', async () => {
    tableConfig = { spaces: { error: { code: '42501', message: 'permission denied for table spaces' } } }

    const err = await spaceCreate({ name: 'x', type: 'project' }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('space_update — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('更新に失敗', async () => {
    tableConfig = { spaces: { error: { code: '42501', message: 'permission denied for table spaces' }, skipCalls: 1 } }

    const err = await spaceUpdate({ spaceId: SPACE, name: 'x' }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('space_list — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('組織のプロジェクト一覧の取得に失敗', async () => {
    tableConfig = { spaces: { error: { code: '42501', message: 'permission denied for table spaces' } } }

    const err = await spaceList({}).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('space_get — 見つからない場合とそれ以外のDBの理由', () => {
  it('PGRST116（0件）なら ToolUserError(404)', async () => {
    tableConfig = {
      spaces: { error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, skipCalls: 1 },
    }

    const err = await spaceGet({ spaceId: SPACE }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect((err as Error).message).not.toContain('JSON object requested')
  })
})
