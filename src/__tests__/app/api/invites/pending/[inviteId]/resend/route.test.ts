import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const VALID_INVITE_ID = '33333333-3333-4333-8333-333333333333'
const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111'
const VALID_SPACE_ID = '22222222-2222-4222-8222-222222222222'

const mockUser = { id: 'user-1', email: 'owner@example.com', user_metadata: {} as Record<string, unknown> }

interface InviteRow {
  id: string
  org_id: string
  space_id: string
  email: string
  role: string
  token: string
  accepted_at: string | null
}

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let inviteLookupResponse: { data: InviteRow | null; error: { message: string } | null }
let updateResponse: { error: { message: string } | null }
let organizationResponse: { data: { name: string } | null }
let spaceResponse: { data: { name: string } | null }
let profileResponse: { data: { display_name: string } | null }

const sendInviteEmailMock = vi.fn(() => Promise.resolve({ success: true, messageId: 'msg-1' }))
vi.mock('@/lib/email', () => ({
  sendInviteEmail: (...args: unknown[]) => sendInviteEmailMock(...args),
}))

const updateEqMock = vi.fn(() => Promise.resolve(updateResponse))
const invitesAdminChain = {
  select: vi.fn(function (this: unknown) { return this }),
  eq: vi.fn(function (this: unknown) { return this }),
  single: vi.fn(() => Promise.resolve(inviteLookupResponse)),
  update: vi.fn(() => ({ eq: updateEqMock })),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(orgMembershipResponse)),
                })),
              })),
            })),
          }
        }
        if (table === 'organizations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(organizationResponse)),
              })),
            })),
          }
        }
        if (table === 'spaces') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(spaceResponse)),
              })),
            })),
          }
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(profileResponse)),
              })),
            })),
          }
        }
        return {}
      }),
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'invites') return invitesAdminChain
      return {}
    }),
  })),
}))

const { POST } = await import('@/app/api/invites/pending/[inviteId]/resend/route')

function callResend(inviteId: string) {
  const request = new NextRequest(
    new URL(`/api/invites/pending/${inviteId}/resend`, 'http://localhost:3000'),
    { method: 'POST' }
  )
  return POST(request, { params: Promise.resolve({ inviteId }) })
}

describe('POST /api/invites/pending/[inviteId]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    orgMembershipResponse = { data: { role: 'owner' } }
    inviteLookupResponse = {
      data: {
        id: VALID_INVITE_ID,
        org_id: VALID_ORG_ID,
        space_id: VALID_SPACE_ID,
        email: 'invitee@example.com',
        role: 'member',
        token: 'tok-existing',
        accepted_at: null,
      },
      error: null,
    }
    updateResponse = { error: null }
    organizationResponse = { data: { name: 'テスト組織' } }
    spaceResponse = { data: { name: 'テストプロジェクト' } }
    profileResponse = { data: { display_name: 'オーナー太郎' } }
    sendInviteEmailMock.mockResolvedValue({ success: true, messageId: 'msg-1' })
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callResend(VALID_INVITE_ID)

    expect(response.status).toBe(401)
  })

  it('returns 404 when the invite does not exist', async () => {
    inviteLookupResponse = { data: null, error: { message: 'not found' } }

    const response = await callResend(VALID_INVITE_ID)

    expect(response.status).toBe(404)
  })

  it('returns 403 when the caller is not the owner of the invite\'s org', async () => {
    orgMembershipResponse = { data: { role: 'member' } }

    const response = await callResend(VALID_INVITE_ID)

    expect(response.status).toBe(403)
  })

  it('returns 409 when the invite has already been accepted', async () => {
    inviteLookupResponse = {
      data: { ...inviteLookupResponse.data!, accepted_at: '2026-07-01T00:00:00Z' },
      error: null,
    }

    const response = await callResend(VALID_INVITE_ID)

    expect(response.status).toBe(409)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('extends expires_at by 90 days, resends the email, and returns success', async () => {
    const response = await callResend(VALID_INVITE_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.email_sent).toBe(true)

    expect(invitesAdminChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: expect.any(String) })
    )
    expect(updateEqMock).toHaveBeenCalledWith('id', VALID_INVITE_ID)

    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invitee@example.com',
        role: 'member',
        token: 'tok-existing',
        orgName: 'テスト組織',
        spaceName: 'テストプロジェクト',
        inviterName: 'オーナー太郎',
      })
    )
  })

  it('reports email_sent: false when the email send fails but still extends the invite', async () => {
    sendInviteEmailMock.mockRejectedValueOnce(new Error('Resend down'))

    const response = await callResend(VALID_INVITE_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.email_sent).toBe(false)
  })

  it('returns 500 when the expires_at update fails', async () => {
    updateResponse = { error: { message: 'db error' } }

    const response = await callResend(VALID_INVITE_ID)

    expect(response.status).toBe(500)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })
})
