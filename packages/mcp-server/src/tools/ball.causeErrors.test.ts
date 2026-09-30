import { describe, it, expect, vi } from 'vitest'

/**
 * ball_pass / ball_query / dashboard_get の getOrgId・タスク確認・再取得・担当者取得は、
 * DBが断った理由を全部「見つかりません」等の一般Errorに潰し、cause も残さなかった。
 * 0件（PGRST116）は ToolUserError(404)、それ以外は一般Errorのままだが、どちらも元の
 * DBエラーを cause に残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'
const ORG = 'org-1'

type TableConfig = { error?: { code?: string; message: string } }
let tableConfig: Record<string, TableConfig> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) c[m] = () => c
  c.single = async () => {
    if (cfg?.error) return { data: null, error: cfg.error }
    if (table === 'tasks') return { data: { id: TASK }, error: null }
    return { data: { org_id: ORG }, error: null }
  }
  c.then = (resolve: (v: unknown) => void) => resolve(cfg?.error ? { data: null, error: cfg.error } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => chain(table),
    rpc: async () => ({ data: null, error: null }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../auth/scope.js', () => ({
  assertUsersHaveSpaceRole: async () => {},
  requireActorUserId: () => 'actor-1',
}))

const { ballPass, ballQuery, dashboardGet } = await import('./ball.js')

function resetTableConfig() {
  tableConfig = {}
}

describe('ball_pass — getOrgId・タスク確認・再取得', () => {
  it('spacesが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (
      await ballPass({ spaceId: SPACE, taskId: TASK, ball: 'internal', clientOwnerIds: [], internalOwnerIds: [] }).catch(
        (e: unknown) => e
      )
    ) as Error & { status?: number; cause?: unknown }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.spaces.error)
  })

  it('tasksの見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.tasks = { error: { code: '42501', message: 'permission denied for table tasks' } }

    const err = (
      await ballPass({ spaceId: SPACE, taskId: TASK, ball: 'internal', clientOwnerIds: [], internalOwnerIds: [] }).catch(
        (e: unknown) => e
      )
    ) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.tasks.error)
  })
})

describe('ball_query / dashboard_get — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('ball_query: タスクの取得に失敗', async () => {
    resetTableConfig()
    tableConfig.tasks = { error: { code: '42501', message: 'permission denied for table tasks' } }

    const err = (await ballQuery({ spaceId: SPACE, ball: 'internal', includeOwners: false, limit: 50 }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.tasks.error)
  })

  it('dashboard_get: 取得に失敗', async () => {
    resetTableConfig()
    tableConfig.tasks = { error: { code: '42501', message: 'permission denied for table tasks' } }

    const err = (await dashboardGet({ spaceId: SPACE }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.tasks.error)
  })
})
