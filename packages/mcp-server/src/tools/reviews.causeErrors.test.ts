import { describe, it, expect, vi } from 'vitest'

/**
 * review_open / review_approve / review_block / review_cancel / review_list / review_get の
 * getOrgId・タスク確認・レビュー取得は、DBが断った理由を全部「見つかりません」等の一般Errorに
 * 潰し、cause も残さなかった。0件（PGRST116）は ToolUserError(404)、それ以外は一般Errorの
 * ままだが、どちらも元のDBエラーを cause に残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'
const ORG = 'org-1'

type TableConfig = { error?: { code?: string; message: string } }
let tableConfig: Record<string, TableConfig> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c
  c.single = async () => {
    if (cfg?.error) return { data: null, error: cfg.error }
    if (table === 'tasks') return { data: { id: TASK }, error: null }
    if (table === 'reviews') return { data: { id: 'review-1' }, error: null }
    return { data: { org_id: ORG }, error: null }
  }
  c.maybeSingle = async () => (cfg?.error ? { data: null, error: cfg.error } : { data: { id: 'review-1' }, error: null })
  c.then = (resolve: (v: unknown) => void) => resolve(cfg?.error ? { data: null, error: cfg.error } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => chain(table),
    rpc: async () => ({ data: null, error: null }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../auth/scope.js', () => ({
  assertUsersHaveSpaceRole: async () => {},
  requireActorUserId: () => 'actor-1',
}))

const { reviewOpen, reviewApprove, reviewBlock, reviewList, reviewGet } = await import('./reviews.js')

function resetTableConfig() {
  tableConfig = {}
}

describe('review_open — getOrgId・タスク確認・レビュー取得', () => {
  it('spacesが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: ['r1'] }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.spaces.error)
  })

  it('tasksの見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.tasks = { error: { code: '42501', message: 'permission denied for table tasks' } }

    const err = (await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: ['r1'] }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.tasks.error)
  })

  it('reviewsの再取得が0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.reviews = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await reviewOpen({ spaceId: SPACE, taskId: TASK, reviewerIds: ['r1'] }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.reviews.error)
  })
})

describe('review_approve / review_block — タスク確認', () => {
  it('review_approve: tasksが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.tasks = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await reviewApprove({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.tasks.error)
  })

  it('review_block: tasksの見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.tasks = { error: { code: '42501', message: 'permission denied for table tasks' } }

    const err = (await reviewBlock({ spaceId: SPACE, taskId: TASK, reason: 'x' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.tasks.error)
  })
})

describe('review_list / review_get — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('review_list: 一覧の取得に失敗', async () => {
    resetTableConfig()
    tableConfig.reviews = { error: { code: '42501', message: 'permission denied for table reviews' } }

    const err = (await reviewList({ spaceId: SPACE, limit: 20 }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.reviews.error)
  })

  it('review_get: review_approvalsの取得に失敗', async () => {
    resetTableConfig()
    tableConfig.review_approvals = { error: { code: '42501', message: 'permission denied for table review_approvals' } }

    const err = (await reviewGet({ spaceId: SPACE, taskId: TASK }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.review_approvals.error)
  })
})
