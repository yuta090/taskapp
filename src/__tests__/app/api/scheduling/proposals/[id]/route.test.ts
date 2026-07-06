import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/scheduling/proposals/[id] — proposal detail with enriched
 * respondents/slot responses.
 * PATCH /api/scheduling/proposals/[id] — cancel (creator or space admin
 * only, and only while the proposal is still open).
 */

const PROPOSAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CREATOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const mockUser = { id: CREATOR_ID }

let authResponse: { data: { user: typeof mockUser | null } }
let proposalDetailResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let membershipResponse: { data: { id: string } | null; error: null }
let profilesResponse: { data: Array<Record<string, unknown>> | null }
let proposalPatchLookupResponse: { data: Record<string, unknown> | null }
let updateResponse: { data: { id: string } | null; error: { message: string } | null }

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

let updateCall: Record<string, unknown> | undefined

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve(authResponse)) },
      from: vi.fn((table: string) => {
        if (table === 'scheduling_proposals') {
          const builder = chain(proposalDetailResponse)
          builder.select = vi.fn(() => {
            // GET uses select(...).eq(id).single() -> proposalDetailResponse
            // PATCH uses select('id, space_id, created_by, status').eq(id).single() -> proposalPatchLookupResponse
            return chain(proposalPatchLookupResponse ?? proposalDetailResponse)
          })
          builder.update = vi.fn((args: Record<string, unknown>) => {
            updateCall = args
            return chain(updateResponse)
          })
          return builder
        }
        if (table === 'space_memberships') {
          // GET's membership check (2 eq's) and PATCH's admin check (3 eq's)
          // both terminate in .single() — one shared response var is enough
          // since GET and PATCH tests never run in the same case.
          return chain(membershipResponse)
        }
        if (table === 'profiles') {
          return chain(profilesResponse)
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { GET, PATCH } = await import('@/app/api/scheduling/proposals/[id]/route')

function callGet(id: string) {
  const request = new NextRequest(new URL(`/api/scheduling/proposals/${id}`, 'http://localhost:3000'))
  return GET(request, { params: Promise.resolve({ id }) })
}

function callPatch(id: string, body: Record<string, unknown>) {
  const request = new NextRequest(new URL(`/api/scheduling/proposals/${id}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

const baseProposal = {
  id: PROPOSAL_ID,
  space_id: SPACE_ID,
  created_by: CREATOR_ID,
  status: 'open',
  proposal_slots: [
    {
      id: 'slot-1',
      slot_responses: [{ id: 'sr-1', respondent_id: 'respondent-1', response: 'available', responded_at: '2026-07-01T00:00:00.000Z' }],
    },
  ],
  proposal_respondents: [{ id: 'respondent-1', user_id: CREATOR_ID, side: 'internal', is_required: true }],
}

describe('GET /api/scheduling/proposals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    proposalDetailResponse = { data: { ...baseProposal }, error: null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proposalPatchLookupResponse = null as any
    membershipResponse = { data: { id: 'membership-1' }, error: null }
    profilesResponse = { data: [{ id: CREATOR_ID, display_name: 'Taro', avatar_url: null }] }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callGet(PROPOSAL_ID)
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed proposal id', async () => {
    const response = await callGet('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('returns 404 when the proposal does not exist', async () => {
    proposalDetailResponse = { data: null, error: { message: 'not found' } }
    const response = await callGet(PROPOSAL_ID)
    expect(response.status).toBe(404)
  })

  it('returns 403 when the user has no membership in the proposal space', async () => {
    membershipResponse = { data: null, error: null }
    const response = await callGet(PROPOSAL_ID)
    expect(response.status).toBe(403)
  })

  it('returns the proposal enriched with respondent display names and slot responses', async () => {
    const response = await callGet(PROPOSAL_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.proposal.proposal_respondents[0].displayName).toBe('Taro')
    expect(data.proposal.proposal_slots[0].responses[0]).toMatchObject({
      userId: CREATOR_ID,
      displayName: 'Taro',
      side: 'internal',
    })
  })
})

describe('PATCH /api/scheduling/proposals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    proposalPatchLookupResponse = {
      data: { id: PROPOSAL_ID, space_id: SPACE_ID, created_by: CREATOR_ID, status: 'open' },
      error: null,
    }
    membershipResponse = { data: null, error: null }
    updateResponse = { data: { id: PROPOSAL_ID }, error: null }
    updateCall = undefined
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed proposal id', async () => {
    const response = await callPatch('not-a-uuid', { status: 'cancelled' })
    expect(response.status).toBe(400)
  })

  it('returns 400 when the status is anything other than cancelled', async () => {
    const response = await callPatch(PROPOSAL_ID, { status: 'open' })
    expect(response.status).toBe(400)
  })

  it('returns 404 when the proposal does not exist', async () => {
    proposalPatchLookupResponse = { data: null, error: null }
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    expect(response.status).toBe(404)
  })

  it('returns 409 when the proposal is not open', async () => {
    proposalPatchLookupResponse = {
      data: { id: PROPOSAL_ID, space_id: SPACE_ID, created_by: CREATOR_ID, status: 'confirmed' },
      error: null,
    }
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    const data = await response.json()
    expect(response.status).toBe(409)
    expect(data.currentStatus).toBe('confirmed')
  })

  it('returns 403 when the user is neither the creator nor a space admin', async () => {
    proposalPatchLookupResponse = {
      data: { id: PROPOSAL_ID, space_id: SPACE_ID, created_by: OTHER_USER_ID, status: 'open' },
      error: null,
    }
    membershipResponse = { data: null, error: null }
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    expect(response.status).toBe(403)
  })

  it('allows a space admin (not the creator) to cancel', async () => {
    proposalPatchLookupResponse = {
      data: { id: PROPOSAL_ID, space_id: SPACE_ID, created_by: OTHER_USER_ID, status: 'open' },
      error: null,
    }
    membershipResponse = { data: { id: 'admin-membership' }, error: null }
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    expect(response.status).toBe(200)
  })

  it('returns 500 when the update fails', async () => {
    updateResponse = { data: null, error: { message: 'db error' } }
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    expect(response.status).toBe(500)
  })

  it('returns 409 when a concurrent request already changed the status (no row updated)', async () => {
    updateResponse = { data: null, error: null }
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    expect(response.status).toBe(409)
  })

  it('cancels the proposal as the creator', async () => {
    const response = await callPatch(PROPOSAL_ID, { status: 'cancelled' })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(updateCall).toEqual({ status: 'cancelled' })
  })
})
