import { describe, it, expect, vi } from 'vitest'

/**
 * milestone_create / milestone_list / milestone_delete / getOrgId は、DBが断った理由を
 * console.error だけに残して一般Errorへ潰し、cause も残さなかった。cause に元のDBエラーを
 * 残すようにする（milestone_get / milestone_update は milestones.errors.test.ts で既に検証済み）。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = 'org-1'

type TableConfig = { error?: { code?: string; message: string } }
let tableConfig: Record<string, TableConfig> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'delete', 'order']) c[m] = () => c
  c.single = async () => {
    if (cfg?.error) return { data: null, error: cfg.error }
    if (table === 'milestones') return { data: { id: 'm1', org_id: ORG, space_id: SPACE, name: 'n', due_date: null, order_key: 1, created_at: 'now' }, error: null }
    return { data: { org_id: ORG }, error: null }
  }
  c.then = (resolve: (v: unknown) => void) => resolve(cfg?.error ? { data: null, error: cfg.error } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { milestoneCreate, milestoneList, milestoneDelete } = await import('./milestones.js')

function resetTableConfig() {
  tableConfig = {}
}

describe('milestone_create / milestone_list / milestone_delete — cause の伝播', () => {
  it('getOrgId: spacesが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await milestoneCreate({ spaceId: SPACE, name: 'n' }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.spaces.error)
  })

  it('milestone_create: 見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.milestones = { error: { code: '42501', message: 'permission denied for table milestones' } }

    const err = (await milestoneCreate({ spaceId: SPACE, name: 'n' }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.milestones.error)
  })

  it('milestone_list: 見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.milestones = { error: { code: '42501', message: 'permission denied for table milestones' } }

    const err = (await milestoneList({ spaceId: SPACE }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.milestones.error)
  })

  it('milestone_delete: 見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.milestones = { error: { code: '42501', message: 'permission denied for table milestones' } }

    const err = (await milestoneDelete({ spaceId: SPACE, milestoneId: 'm1' }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.milestones.error)
  })
})
