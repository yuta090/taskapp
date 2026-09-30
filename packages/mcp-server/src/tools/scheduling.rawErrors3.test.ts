import { describe, it, expect, vi } from 'vitest'

/**
 * create_scheduling_proposal（スペース確認）/ respond_to_proposal（提案・回答者確認）/
 * cancel_scheduling_proposal（提案確認）/ get_proposal_responses（提案確認）/
 * send_proposal_reminder（提案確認）は、DBが断った理由を全部「見つかりません」等の一般
 * Errorに潰し、cause も残さなかった。0件（PGRST116）は ToolUserError(404)、それ以外は
 * 一般Errorのままだが、どちらも元のDBエラーを cause に残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PROPOSAL = '00000000-0000-0000-0000-000000000003'
const SLOT = '00000000-0000-0000-0000-000000000004'
const USER = '00000000-0000-0000-0000-000000000001'

type TableConfig = { error?: { code?: string; message: string } }
let tableConfig: Record<string, TableConfig> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'insert', 'update']) c[m] = () => c
  c.single = async () => {
    if (cfg?.error) return { data: null, error: cfg.error }
    if (table === 'spaces') return { data: { org_id: 'org-1' }, error: null }
    if (table === 'scheduling_proposals') return { data: { id: PROPOSAL, status: 'open', space_id: SPACE, org_id: 'org-1' }, error: null }
    if (table === 'proposal_respondents') return { data: { id: 'respondent-1' }, error: null }
    return { data: { id: 'row-1' }, error: null }
  }
  c.then = (resolve: (v: unknown) => void) => {
    if (cfg?.error) return resolve({ data: null, error: cfg.error })
    if (table === 'proposal_slots') return resolve({ data: [{ id: SLOT }], error: null })
    return resolve({ data: [], error: null })
  }
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () => ({ allowed: true, role: 'admin' }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ userId: 'actor-1' }),
}))
vi.mock('../auth/scope.js', () => ({
  assertUsersAreSpaceMembers: async () => {},
  requireActorUserId: () => 'actor-1',
}))

const { schedulingCreate, schedulingRespond, schedulingCancel, schedulingGetResponses, schedulingSendReminder } = await import(
  './scheduling.js'
)

function resetTableConfig() {
  tableConfig = {}
}

const createBase = {
  spaceId: SPACE,
  title: 'MTG',
  slots: [
    { startAt: '2026-10-01T00:00:00Z', endAt: '2026-10-01T01:00:00Z' },
    { startAt: '2026-10-02T00:00:00Z', endAt: '2026-10-02T01:00:00Z' },
  ],
  respondents: [{ userId: USER, side: 'client' as const, isRequired: true }],
}

describe('create_scheduling_proposal — スペース確認', () => {
  it('0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await schedulingCreate(createBase).catch((e: unknown) => e)) as Error & { status?: number; cause?: unknown }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.spaces.error)
  })
})

describe('respond_to_proposal — 提案・回答者確認', () => {
  it('提案の確認が0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.scheduling_proposals = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (
      await schedulingRespond({
        spaceId: SPACE,
        proposalId: PROPOSAL,
        responses: [{ slotId: SLOT, response: 'available' }],
      }).catch((e: unknown) => e)
    ) as Error & { status?: number; cause?: unknown }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.scheduling_proposals.error)
  })

  it('回答者確認の見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.proposal_respondents = { error: { code: '42501', message: 'permission denied for table proposal_respondents' } }

    const err = (
      await schedulingRespond({
        spaceId: SPACE,
        proposalId: PROPOSAL,
        responses: [{ slotId: SLOT, response: 'available' }],
      }).catch((e: unknown) => e)
    ) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.proposal_respondents.error)
  })
})

describe('cancel_scheduling_proposal / get_proposal_responses / send_proposal_reminder — 提案確認', () => {
  it('cancel: 0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.scheduling_proposals = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (
      await schedulingCancel({ spaceId: SPACE, proposalId: PROPOSAL, action: 'cancel' }).catch((e: unknown) => e)
    ) as Error & { status?: number; cause?: unknown }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.scheduling_proposals.error)
  })

  it('get_proposal_responses: 見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.scheduling_proposals = { error: { code: '42501', message: 'permission denied for table scheduling_proposals' } }

    const err = (await schedulingGetResponses({ spaceId: SPACE, proposalId: PROPOSAL }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.scheduling_proposals.error)
  })

  it('send_proposal_reminder: 0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.scheduling_proposals = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await schedulingSendReminder({ spaceId: SPACE, proposalId: PROPOSAL }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.scheduling_proposals.error)
  })
})
