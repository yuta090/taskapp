import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// 回帰テスト: scheduling_proposals ↔ proposal_slots はFKが2本あるため
// (proposal_slots.proposal_id と scheduling_proposals.confirmed_slot_id)、
// 埋め込みは `proposal_slots!proposal_slots_proposal_id_fkey` と明示しないと
// PostgRESTがPGRST201(曖昧なリレーション)を返し、本APIは常に500になる。
// 本番QAで発見: ポータルの日程調整一覧がクライアントに一切表示されなかった。

const mockUser = { id: 'client-user-1' }

let authResponse: { data: { user: typeof mockUser | null } }
let membershipData: Array<{ id: string; role: string; space_id: string }>
let respondentData: Array<{ proposal_id: string }>
let proposalsResponse: { data: Record<string, unknown>[] | null; error: { code: string; message: string } | null }

const proposalSelectSpy = vi.fn()

function makeThenableChain(table: string) {
  const resolve = () => {
    if (table === 'space_memberships') return { data: membershipData, error: null }
    if (table === 'proposal_respondents') return { data: respondentData, error: null }
    if (table === 'scheduling_proposals') return proposalsResponse
    if (table === 'slot_responses') return { data: [], error: null }
    return { data: [], error: null }
  }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'is', 'gt']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      if (table === 'scheduling_proposals' && m === 'select') proposalSelectSpy(args[0])
      return chain
    })
  }
  chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled)
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve(authResponse)) },
      from: vi.fn((table: string) => makeThenableChain(table)),
    })
  ),
}))

const { GET } = await import('@/app/api/portal/scheduling/proposals/route')

const SPACE_ID = '00000000-0000-0000-0000-000000000010'

function callGet(spaceId?: string) {
  const url = new URL('/api/portal/scheduling/proposals', 'http://localhost:3000')
  if (spaceId) url.searchParams.set('spaceId', spaceId)
  return GET(new NextRequest(url))
}

describe('GET /api/portal/scheduling/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    membershipData = [{ id: 'm1', role: 'client', space_id: SPACE_ID }]
    respondentData = [{ proposal_id: 'p1' }]
    proposalsResponse = {
      data: [
        {
          id: 'p1',
          status: 'open',
          proposal_slots: [{ id: 'slot-1' }, { id: 'slot-2' }],
          proposal_respondents: [{ id: 'r1', user_id: mockUser.id, side: 'client', is_required: true }],
        },
      ],
      error: null,
    }
  })

  it('未認証は401', async () => {
    authResponse = { data: { user: null } }
    const res = await callGet(SPACE_ID)
    expect(res.status).toBe(401)
  })

  it('clientメンバーシップがなければ403', async () => {
    membershipData = []
    const res = await callGet(SPACE_ID)
    expect(res.status).toBe(403)
  })

  it('proposal_slotsの埋め込みはFKを明示して曖昧さを回避する(PGRST201回帰)', async () => {
    const res = await callGet(SPACE_ID)
    expect(res.status).toBe(200)

    expect(proposalSelectSpy).toHaveBeenCalledTimes(1)
    const embed = proposalSelectSpy.mock.calls[0][0] as string
    expect(embed).toContain('proposal_slots!proposal_slots_proposal_id_fkey')
    // FK未指定の裸の埋め込み(曖昧)が残っていないこと
    expect(embed.replace('proposal_slots!proposal_slots_proposal_id_fkey', '')).not.toMatch(/proposal_slots\s*\(/)
  })

  it('回答済みスロット数と自分のrespondent IDを付与して返す', async () => {
    const res = await callGet(SPACE_ID)
    const body = await res.json()
    expect(body.proposals).toHaveLength(1)
    expect(body.proposals[0].myRespondentId).toBe('r1')
    expect(body.proposals[0].totalSlots).toBe(2)
  })

  it('respondentが0件なら空配列を返す(500にしない)', async () => {
    respondentData = []
    const res = await callGet(SPACE_ID)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.proposals).toEqual([])
  })
})
