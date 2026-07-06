import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/scheduling/responses — internal user submits/updates slot
 * availability responses for an open proposal.
 */

const PROPOSAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SLOT_ID_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SLOT_ID_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const mockUser = { id: USER_ID }

let authResponse: { data: { user: typeof mockUser | null } }
let proposalResponse: { data: Record<string, unknown> | null }
let respondentResponse: { data: { id: string } | null }
let validSlotsResponse: { data: Array<{ id: string }> | null }
let upsertResponse: { error: { message: string } | null }
let upsertCall: Array<Record<string, unknown>> | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) {
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
        if (table === 'scheduling_proposals') return chain(proposalResponse)
        if (table === 'proposal_respondents') return chain(respondentResponse)
        if (table === 'proposal_slots') return chain(validSlotsResponse)
        if (table === 'slot_responses') {
          return {
            upsert: vi.fn((args: Array<Record<string, unknown>>) => {
              upsertCall = args
              return Promise.resolve(upsertResponse)
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { POST } = await import('@/app/api/scheduling/responses/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/scheduling/responses', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: PROPOSAL_ID,
    responses: [{ slotId: SLOT_ID_1, response: 'available' }],
    ...overrides,
  }
}

describe('POST /api/scheduling/responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertCall = undefined

    authResponse = { data: { user: mockUser } }
    proposalResponse = { data: { id: PROPOSAL_ID, status: 'open', expires_at: null } }
    respondentResponse = { data: { id: 'respondent-1' } }
    validSlotsResponse = { data: [{ id: SLOT_ID_1 }] }
    upsertResponse = { error: null }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callPost(validBody())
    expect(response.status).toBe(401)
  })

  it('returns 400 when proposalId is missing or malformed', async () => {
    const response = await callPost(validBody({ proposalId: 'not-a-uuid' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when responses is empty', async () => {
    const response = await callPost(validBody({ responses: [] }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when responses exceeds 5 items', async () => {
    const response = await callPost(
      validBody({
        responses: Array.from({ length: 6 }, (_, i) => ({ slotId: SLOT_ID_1, response: 'available' + i })),
      })
    )
    expect(response.status).toBe(400)
  })

  it('returns 400 when a slotId is malformed', async () => {
    const response = await callPost(validBody({ responses: [{ slotId: 'not-a-uuid', response: 'available' }] }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when the same slotId appears twice', async () => {
    const response = await callPost(
      validBody({
        responses: [
          { slotId: SLOT_ID_1, response: 'available' },
          { slotId: SLOT_ID_1, response: 'unavailable' },
        ],
      })
    )
    expect(response.status).toBe(400)
  })

  it('returns 400 when the response value is invalid', async () => {
    const response = await callPost(validBody({ responses: [{ slotId: SLOT_ID_1, response: 'maybe' }] }))
    expect(response.status).toBe(400)
  })

  it('returns 404 when the proposal does not exist', async () => {
    proposalResponse = { data: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(404)
  })

  it('returns 409 when the proposal is not open', async () => {
    proposalResponse = { data: { id: PROPOSAL_ID, status: 'confirmed', expires_at: null } }
    const response = await callPost(validBody())
    const data = await response.json()
    expect(response.status).toBe(409)
    expect(data.currentStatus).toBe('confirmed')
  })

  it('returns 409 when the proposal has expired', async () => {
    proposalResponse = {
      data: { id: PROPOSAL_ID, status: 'open', expires_at: new Date(Date.now() - 1000).toISOString() },
    }
    const response = await callPost(validBody())
    expect(response.status).toBe(409)
  })

  it('returns 403 when the user is not a respondent for the proposal', async () => {
    respondentResponse = { data: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(403)
  })

  it('returns 400 when a slotId does not belong to the proposal', async () => {
    validSlotsResponse = { data: [] }
    const response = await callPost(validBody())
    expect(response.status).toBe(400)
  })

  it('returns 500 when the upsert fails', async () => {
    upsertResponse = { error: { message: 'db error' } }
    const response = await callPost(validBody())
    expect(response.status).toBe(500)
  })

  it('upserts the responses and returns ok with the updated count', async () => {
    validSlotsResponse = { data: [{ id: SLOT_ID_1 }, { id: SLOT_ID_2 }] }
    const response = await callPost(
      validBody({
        responses: [
          { slotId: SLOT_ID_1, response: 'available' },
          { slotId: SLOT_ID_2, response: 'unavailable_but_proceed' },
        ],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ ok: true, updatedCount: 2 })
    expect(upsertCall).toHaveLength(2)
    expect(upsertCall?.[0]).toMatchObject({ slot_id: SLOT_ID_1, respondent_id: 'respondent-1', response: 'available' })
  })

  it('returns 500 when the request body is not valid JSON', async () => {
    const request = new NextRequest(new URL('/api/scheduling/responses', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
