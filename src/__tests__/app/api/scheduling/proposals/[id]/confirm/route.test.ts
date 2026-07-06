import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/scheduling/proposals/[id]/confirm — atomically confirms a slot
 * via rpc_confirm_proposal_slot, then (best-effort, non-blocking) creates a
 * video conference meeting when the proposal has a configured provider.
 */

const PROPOSAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SLOT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SPACE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CREATOR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OTHER_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const mockUser = { id: CREATOR_ID }

let authResponse: { data: { user: typeof mockUser | null } }
let proposalLookupResponse: { data: Record<string, unknown> | null }
let membershipResponse: { data: { id: string } | null; error: null }
let confirmRpcResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let respondentsResponse: { data: Array<Record<string, unknown>> | null }
let proposalsUpdateCall: Record<string, unknown> | undefined
let meetingsUpdateCall: Record<string, unknown> | undefined

const isConfiguredMock = vi.fn(() => true)
const createMeetingMock = vi.fn(() =>
  Promise.resolve({ meetingUrl: 'https://meet.example.com/abc', externalMeetingId: 'ext-1' })
)

vi.mock('@/lib/video-conference', () => ({
  videoConferenceRegistry: {
    get: vi.fn(() => ({
      name: 'google_meet',
      isConfigured: isConfiguredMock,
      createMeeting: createMeetingMock,
    })),
  },
}))

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
      rpc: vi.fn(() => Promise.resolve(confirmRpcResponse)),
      from: vi.fn((table: string) => {
        if (table === 'scheduling_proposals') {
          const builder = chain(proposalLookupResponse)
          builder.update = vi.fn((args: Record<string, unknown>) => {
            proposalsUpdateCall = args
            return chain({ data: null, error: null })
          })
          return builder
        }
        if (table === 'space_memberships') return chain(membershipResponse)
        if (table === 'proposal_respondents') return chain(respondentsResponse)
        if (table === 'meetings') {
          const builder = chain({ data: null, error: null })
          builder.update = vi.fn((args: Record<string, unknown>) => {
            meetingsUpdateCall = args
            return chain({ data: null, error: null })
          })
          return builder
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { POST } = await import('@/app/api/scheduling/proposals/[id]/confirm/route')

function callPost(id: string, body: Record<string, unknown>) {
  const request = new NextRequest(new URL(`/api/scheduling/proposals/${id}/confirm`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ id }) })
}

const baseProposal = {
  id: PROPOSAL_ID,
  space_id: SPACE_ID,
  created_by: CREATOR_ID,
  video_provider: null as string | null,
  title: 'キックオフMTG',
  duration_minutes: 60,
}

describe('POST /api/scheduling/proposals/[id]/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isConfiguredMock.mockReturnValue(true)
    createMeetingMock.mockResolvedValue({ meetingUrl: 'https://meet.example.com/abc', externalMeetingId: 'ext-1' })
    proposalsUpdateCall = undefined
    meetingsUpdateCall = undefined

    authResponse = { data: { user: mockUser } }
    proposalLookupResponse = { data: { ...baseProposal } }
    membershipResponse = { data: null, error: null }
    confirmRpcResponse = {
      data: { ok: true, meeting_id: 'meeting-1', slot_start: '2026-08-01T10:00:00+09:00', slot_end: '2026-08-01T11:00:00+09:00' },
      error: null,
    }
    respondentsResponse = {
      data: [{ user_id: CREATOR_ID, profiles: { display_name: 'Taro', email: 'taro@example.com' } }],
    }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed proposal id', async () => {
    const response = await callPost('not-a-uuid', { slotId: SLOT_ID })
    expect(response.status).toBe(400)
  })

  it('returns 400 when slotId is missing or malformed', async () => {
    const response = await callPost(PROPOSAL_ID, { slotId: 'not-a-uuid' })
    expect(response.status).toBe(400)
  })

  it('returns 404 when the proposal does not exist', async () => {
    proposalLookupResponse = { data: null }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(404)
  })

  it('returns 403 when the user is neither the creator nor a space admin', async () => {
    proposalLookupResponse = { data: { ...baseProposal, created_by: OTHER_USER_ID } }
    membershipResponse = { data: null, error: null }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(403)
  })

  it('allows a space admin (not the creator) to confirm', async () => {
    proposalLookupResponse = { data: { ...baseProposal, created_by: OTHER_USER_ID } }
    membershipResponse = { data: { id: 'admin-membership' }, error: null }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(200)
  })

  it('returns 500 when the RPC call itself errors', async () => {
    confirmRpcResponse = { data: null, error: { message: 'rpc failure' } }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(500)
  })

  it('returns 409 when the proposal is no longer open (double confirmation)', async () => {
    confirmRpcResponse = { data: { ok: false, error: 'proposal_not_open' }, error: null }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    const data = await response.json()
    expect(response.status).toBe(409)
    expect(data.error).toBe('proposal_not_open')
  })

  it('returns 400 when not all required respondents have agreed to the slot', async () => {
    confirmRpcResponse = { data: { ok: false, error: 'not_all_agreed' }, error: null }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(400)
  })

  it('returns 500 for any other RPC-reported failure', async () => {
    confirmRpcResponse = { data: { ok: false, error: 'unexpected' }, error: null }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(500)
  })

  it('confirms the slot without creating a meeting when no video provider is set', async () => {
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.meetingId).toBe('meeting-1')
    expect(data.meetingUrl).toBeNull()
    expect(createMeetingMock).not.toHaveBeenCalled()
  })

  it('creates a video conference meeting when the proposal has a configured provider', async () => {
    proposalLookupResponse = { data: { ...baseProposal, video_provider: 'google_meet' } }
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(createMeetingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'キックオフMTG',
        participants: [{ email: 'taro@example.com', name: 'Taro' }],
        idempotencyKey: `proposal-${PROPOSAL_ID}-slot-${SLOT_ID}`,
      })
    )
    expect(data.meetingUrl).toBe('https://meet.example.com/abc')
    expect(data.externalMeetingId).toBe('ext-1')
    expect(proposalsUpdateCall).toMatchObject({ meeting_url: 'https://meet.example.com/abc', external_meeting_id: 'ext-1' })
    expect(meetingsUpdateCall).toMatchObject({ meeting_url: 'https://meet.example.com/abc', video_provider: 'google_meet' })
  })

  it('skips meeting creation when the provider is registered but not configured', async () => {
    proposalLookupResponse = { data: { ...baseProposal, video_provider: 'google_meet' } }
    isConfiguredMock.mockReturnValue(false)
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(response.status).toBe(200)
    expect(createMeetingMock).not.toHaveBeenCalled()
  })

  it('excludes respondents with no email from the meeting participant list', async () => {
    proposalLookupResponse = { data: { ...baseProposal, video_provider: 'google_meet' } }
    respondentsResponse = {
      data: [
        { user_id: CREATOR_ID, profiles: { display_name: 'Taro', email: 'taro@example.com' } },
        { user_id: OTHER_USER_ID, profiles: { display_name: 'NoEmail', email: null } },
      ],
    }
    await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    expect(createMeetingMock).toHaveBeenCalledWith(
      expect.objectContaining({ participants: [{ email: 'taro@example.com', name: 'Taro' }] })
    )
  })

  it('still confirms the slot (200, no meeting) when video conference creation throws', async () => {
    proposalLookupResponse = { data: { ...baseProposal, video_provider: 'google_meet' } }
    createMeetingMock.mockRejectedValueOnce(new Error('provider outage'))
    const response = await callPost(PROPOSAL_ID, { slotId: SLOT_ID })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.meetingUrl).toBeNull()
    expect(data.meetingId).toBe('meeting-1')
  })

  it('returns 500 when the request body is not valid JSON', async () => {
    const request = new NextRequest(new URL(`/api/scheduling/proposals/${PROPOSAL_ID}/confirm`, 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })
    const response = await POST(request, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(500)
  })
})
