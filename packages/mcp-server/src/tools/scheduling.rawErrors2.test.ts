import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * create_scheduling_proposal / respond_to_proposal / get_proposal_responses /
 * send_proposal_reminder は、見覚えのないDBの理由を、次にできることが分かる
 * ヒント（重複・必須項目の不足・つながりの不整合）があればそれを、無ければ
 * 決まった一般のメッセージを返す（生の文言は出さない）。
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
  for (const m of ['select', 'eq', 'order', 'in']) c[m] = () => c
  c.insert = () => c
  c.upsert = () => c
  c.single = async () => {
    if (cfg?.error) return { data: null, error: cfg.error }
    if (table === 'scheduling_proposals') return { data: { id: PROPOSAL, status: 'open', space_id: SPACE }, error: null }
    if (table === 'proposal_respondents') return { data: { id: 'respondent-1' }, error: null }
    return { data: { id: 'row-1', org_id: 'org-1' }, error: null }
  }
  c.then = (resolve: (v: unknown) => void) => {
    if (cfg?.error) return resolve({ data: null, error: cfg.error })
    if (table === 'proposal_slots') return resolve({ data: [{ id: SLOT }], error: null })
    // send_proposal_reminder: 未回答者が1人いる状態にして、通知の保存まで到達させる
    if (table === 'proposal_respondents') return resolve({ data: [{ id: 'respondent-1', user_id: USER, slot_responses: [] }], error: null })
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
}))

const { schedulingCreate, schedulingRespond, schedulingGetResponses, schedulingSendReminder } = await import(
  './scheduling.js'
)

beforeEach(() => {
  tableConfig = {}
})

const createBase = {
  spaceId: SPACE,
  title: 'MTG',
  slots: [
    { startAt: '2026-10-01T00:00:00Z', endAt: '2026-10-01T01:00:00Z' },
    { startAt: '2026-10-02T00:00:00Z', endAt: '2026-10-02T01:00:00Z' },
  ],
  respondents: [{ userId: USER, side: 'client' as const, isRequired: true }],
}

describe('create_scheduling_proposal — 重複はヒント、それ以外は一般のエラー', () => {
  it('提案の作成に失敗（重複=23505ならヒント。ToolUserErrorなのでCLI経由でも届く）', async () => {
    tableConfig = { scheduling_proposals: { error: { code: '23505', message: 'duplicate key value violates unique constraint' } } }

    const err = await schedulingCreate(createBase).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toContain('重複')
    expect((err as Error).message).not.toContain('duplicate key')
  })

  it('候補日時の作成に失敗（見覚えのないコードは一般のエラー）', async () => {
    tableConfig = { proposal_slots: { error: { code: '42501', message: 'permission denied for table proposal_slots' } } }

    const err = await schedulingCreate(createBase).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('回答者の登録に失敗（見覚えのないコードは一般のエラー）', async () => {
    tableConfig = { proposal_respondents: { error: { code: '42501', message: 'permission denied for table proposal_respondents' } } }

    const err = await schedulingCreate(createBase).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('respond_to_proposal — 見覚えのないDBの理由は一般のエラー', () => {
  it('回答の保存に失敗', async () => {
    tableConfig = { slot_responses: { error: { code: '42501', message: 'permission denied for table slot_responses' } } }

    const err = await schedulingRespond({
      spaceId: SPACE,
      proposalId: PROPOSAL,
      responses: [{ slotId: SLOT, response: 'available' }],
    }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('get_proposal_responses — 見覚えのないDBの理由は一般のエラー', () => {
  it('回答者情報の取得に失敗', async () => {
    tableConfig = { proposal_respondents: { error: { code: '42501', message: 'permission denied for table proposal_respondents' } } }

    const err = await schedulingGetResponses({ spaceId: SPACE, proposalId: PROPOSAL }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('スロット情報の取得に失敗', async () => {
    tableConfig = { proposal_slots: { error: { code: '42501', message: 'permission denied for table proposal_slots' } } }

    const err = await schedulingGetResponses({ spaceId: SPACE, proposalId: PROPOSAL }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('send_proposal_reminder — 見覚えのないDBの理由は一般のエラー', () => {
  it('回答者情報の取得に失敗', async () => {
    tableConfig = { proposal_respondents: { error: { code: '42501', message: 'permission denied for table proposal_respondents' } } }

    const err = await schedulingSendReminder({ spaceId: SPACE, proposalId: PROPOSAL }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('リマインド送信(通知の保存)に失敗', async () => {
    tableConfig = { notifications: { error: { code: '42501', message: 'permission denied for table notifications' } } }

    const err = await schedulingSendReminder({ spaceId: SPACE, proposalId: PROPOSAL }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})
