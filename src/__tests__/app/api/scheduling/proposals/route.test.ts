import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/scheduling/proposals — creates a proposal + slots + respondents,
 * and auto-marks the creator as "available" for every slot.
 * GET /api/scheduling/proposals — lists proposals for a space with
 * respondent/response counts.
 */

const SPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const RESPONDENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const mockUser = { id: USER_ID }

function futureIso(daysAhead = 1): string {
  return new Date(Date.now() + daysAhead * 86400000).toISOString()
}

function validSlot(daysAhead = 1) {
  const start = futureIso(daysAhead)
  const end = new Date(new Date(start).getTime() + 3600000).toISOString()
  return { startAt: start, endAt: end }
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    spaceId: SPACE_ID,
    title: 'キックオフMTG',
    description: '日程調整のテストです',
    durationMinutes: 60,
    slots: [validSlot(1), validSlot(2)],
    respondents: [{ userId: USER_ID, side: 'internal' }, { userId: OTHER_UUID, side: 'client' }],
    ...overrides,
  }
}

let authResponse: { data: { user: typeof mockUser | null } }
let membershipResponse: { data: { id: string; role: string } | null; error: null }
let spaceResponse: { data: { org_id: string } | null; error: null }
let proposalInsertResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let slotsInsertResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let respondentsInsertResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let autoResponseInsertResponse: { error: { message: string } | null }
let proposalsListResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let responseCountsResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }

let respondentsInsertCall: Array<Record<string, unknown>> | undefined
let slotsInsertCall: Array<Record<string, unknown>> | undefined
let autoResponseInsertCall: Array<Record<string, unknown>> | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'insert', 'update', 'upsert']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (resolve: any, reject?: any) => Promise.resolve(response).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve(authResponse)) },
      from: vi.fn((table: string) => {
        if (table === 'space_memberships') return chain(membershipResponse)
        if (table === 'spaces') return chain(spaceResponse)
        if (table === 'scheduling_proposals') {
          const builder = chain(proposalsListResponse)
          builder.insert = vi.fn(() => chain(proposalInsertResponse))
          return builder
        }
        if (table === 'proposal_slots') {
          const builder = chain(slotsInsertResponse)
          builder.insert = vi.fn((args: Array<Record<string, unknown>>) => {
            slotsInsertCall = args
            return chain(slotsInsertResponse)
          })
          return builder
        }
        if (table === 'proposal_respondents') {
          const builder = chain(respondentsInsertResponse)
          builder.insert = vi.fn((args: Array<Record<string, unknown>>) => {
            respondentsInsertCall = args
            return chain(respondentsInsertResponse)
          })
          return builder
        }
        if (table === 'slot_responses') {
          const builder = chain(responseCountsResponse)
          builder.insert = vi.fn((args: Array<Record<string, unknown>>) => {
            autoResponseInsertCall = args
            return Promise.resolve(autoResponseInsertResponse)
          })
          return builder
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { POST, GET } = await import('@/app/api/scheduling/proposals/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/scheduling/proposals', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function callGet(spaceId?: string) {
  const url = new URL('/api/scheduling/proposals', 'http://localhost:3000')
  if (spaceId !== undefined) url.searchParams.set('spaceId', spaceId)
  return GET(new NextRequest(url))
}

describe('POST /api/scheduling/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    slotsInsertCall = undefined
    respondentsInsertCall = undefined
    autoResponseInsertCall = undefined

    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: { id: 'membership-1', role: 'admin' }, error: null }
    spaceResponse = { data: { org_id: 'org-1' }, error: null }
    proposalInsertResponse = { data: { id: 'proposal-1', space_id: SPACE_ID, org_id: 'org-1' }, error: null }
    slotsInsertResponse = {
      data: [{ id: 'slot-1' }, { id: 'slot-2' }],
      error: null,
    }
    respondentsInsertResponse = {
      data: [
        { id: RESPONDENT_ID, user_id: USER_ID, proposal_id: 'proposal-1' },
        { id: 'respondent-2', user_id: OTHER_UUID, proposal_id: 'proposal-1' },
      ],
      error: null,
    }
    autoResponseInsertResponse = { error: null }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callPost(validBody())
    expect(response.status).toBe(401)
  })

  it('returns 400 when spaceId is missing or malformed', async () => {
    const response = await callPost(validBody({ spaceId: 'not-a-uuid' }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toMatch(/spaceId/)
  })

  it('returns 400 when title is empty', async () => {
    const response = await callPost(validBody({ title: '' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when title exceeds 200 characters', async () => {
    const response = await callPost(validBody({ title: 'a'.repeat(201) }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when description is not a string', async () => {
    const response = await callPost(validBody({ description: 123 }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when description exceeds 1000 characters', async () => {
    const response = await callPost(validBody({ description: 'a'.repeat(1001) }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when durationMinutes is out of range', async () => {
    const tooShort = await callPost(validBody({ durationMinutes: 10 }))
    expect(tooShort.status).toBe(400)
    const tooLong = await callPost(validBody({ durationMinutes: 500 }))
    expect(tooLong.status).toBe(400)
  })

  it('returns 400 when slots count is out of range (min 2, max 5)', async () => {
    const tooFew = await callPost(validBody({ slots: [validSlot(1)] }))
    expect(tooFew.status).toBe(400)

    const tooMany = await callPost(
      validBody({ slots: [validSlot(1), validSlot(2), validSlot(3), validSlot(4), validSlot(5), validSlot(6)] })
    )
    expect(tooMany.status).toBe(400)
  })

  it('returns 400 when respondents is empty or exceeds 50', async () => {
    const empty = await callPost(validBody({ respondents: [] }))
    expect(empty.status).toBe(400)

    const tooMany = await callPost(
      validBody({
        respondents: Array.from({ length: 51 }, (_, i) => ({
          userId: `${OTHER_UUID.slice(0, -2)}${String(i).padStart(2, '0')}`,
          side: 'internal',
        })),
      })
    )
    expect(tooMany.status).toBe(400)
  })

  it('returns 400 when a slot is missing startAt/endAt', async () => {
    const response = await callPost(validBody({ slots: [{ startAt: futureIso(1) }, validSlot(2)] }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when a slot has an invalid date format', async () => {
    const response = await callPost(
      validBody({ slots: [{ startAt: 'not-a-date', endAt: futureIso(1) }, validSlot(2)] })
    )
    expect(response.status).toBe(400)
  })

  it('returns 400 when endAt is not after startAt', async () => {
    const start = futureIso(1)
    const response = await callPost(validBody({ slots: [{ startAt: start, endAt: start }, validSlot(2)] }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when a slot is in the past', async () => {
    const response = await callPost(
      validBody({
        slots: [{ startAt: new Date(Date.now() - 86400000).toISOString(), endAt: futureIso(1) }, validSlot(2)],
      })
    )
    expect(response.status).toBe(400)
  })

  it('returns 400 when a respondent userId is invalid', async () => {
    const response = await callPost(validBody({ respondents: [{ userId: 'not-a-uuid', side: 'internal' }] }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when a respondent side is invalid', async () => {
    const response = await callPost(validBody({ respondents: [{ userId: USER_ID, side: 'other' }] }))
    expect(response.status).toBe(400)
  })

  it('dedupes respondents with the same userId before inserting', async () => {
    const response = await callPost(
      validBody({
        respondents: [
          { userId: USER_ID, side: 'internal' },
          { userId: USER_ID, side: 'internal' },
          { userId: OTHER_UUID, side: 'client' },
        ],
      })
    )
    expect(response.status).toBe(201)
    expect(respondentsInsertCall).toHaveLength(2)
  })

  it('returns 403 when the user has no membership in the space', async () => {
    membershipResponse = { data: null, error: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(403)
  })

  it('returns 404 when the space does not exist', async () => {
    spaceResponse = { data: null, error: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(404)
  })

  it('returns 500 when the proposal insert fails', async () => {
    proposalInsertResponse = { data: null, error: { message: 'db error' } }
    const response = await callPost(validBody())
    expect(response.status).toBe(500)
  })

  it('returns 500 when the slots insert fails', async () => {
    slotsInsertResponse = { data: null, error: { message: 'db error' } }
    const response = await callPost(validBody())
    expect(response.status).toBe(500)
  })

  it('returns 500 when the respondents insert fails', async () => {
    respondentsInsertResponse = { data: null, error: { message: 'db error' } }
    const response = await callPost(validBody())
    expect(response.status).toBe(500)
  })

  it('creates the proposal, slots, respondents, and auto-marks the creator as available', async () => {
    const response = await callPost(validBody())
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.proposal.id).toBe('proposal-1')
    expect(data.proposal.slots).toEqual(slotsInsertResponse.data)
    expect(data.proposal.respondents).toEqual(respondentsInsertResponse.data)
    expect(slotsInsertCall).toHaveLength(2)
    expect(autoResponseInsertCall).toHaveLength(2)
    expect(autoResponseInsertCall?.every((r) => r.respondent_id === RESPONDENT_ID && r.response === 'available')).toBe(
      true
    )
  })

  it('does not auto-mark availability when the creator is not among the respondents', async () => {
    respondentsInsertResponse = {
      data: [{ id: 'respondent-2', user_id: OTHER_UUID, proposal_id: 'proposal-1' }],
      error: null,
    }
    const response = await callPost(validBody({ respondents: [{ userId: OTHER_UUID, side: 'client' }] }))
    expect(response.status).toBe(201)
    expect(autoResponseInsertCall).toBeUndefined()
  })

  it('still returns 201 when the auto-response insert fails (non-fatal)', async () => {
    autoResponseInsertResponse = { error: { message: 'db error' } }
    const response = await callPost(validBody())
    expect(response.status).toBe(201)
  })

  it('returns 500 when the request body is not valid JSON', async () => {
    const request = new NextRequest(new URL('/api/scheduling/proposals', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})

describe('GET /api/scheduling/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: { id: 'membership-1', role: 'admin' }, error: null }
    proposalsListResponse = {
      data: [
        {
          id: 'proposal-1',
          proposal_respondents: [{ id: 'r1' }, { id: 'r2' }],
        },
      ],
      error: null,
    }
    responseCountsResponse = {
      data: [
        { respondent_id: 'r1', proposal_respondents: { proposal_id: 'proposal-1' } },
        { respondent_id: 'r2', proposal_respondents: { proposal_id: 'proposal-1' } },
      ],
      error: null,
    }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callGet(SPACE_ID)
    expect(response.status).toBe(401)
  })

  it('returns 400 when spaceId is missing or malformed', async () => {
    const response = await callGet('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('returns 403 when the user has no membership in the space', async () => {
    membershipResponse = { data: null, error: null }
    const response = await callGet(SPACE_ID)
    expect(response.status).toBe(403)
  })

  it('returns 500 when the proposals fetch fails', async () => {
    proposalsListResponse = { data: null, error: { message: 'db error' } }
    const response = await callGet(SPACE_ID)
    expect(response.status).toBe(500)
  })

  it('returns proposals with respondentCount and responseCount', async () => {
    const response = await callGet(SPACE_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.proposals).toHaveLength(1)
    expect(data.proposals[0].respondentCount).toBe(2)
    expect(data.proposals[0].responseCount).toBe(2)
  })

  it('returns responseCount 0 when there are no proposals', async () => {
    proposalsListResponse = { data: [], error: null }
    const response = await callGet(SPACE_ID)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.proposals).toEqual([])
  })
})
