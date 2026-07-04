import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111'
const VALID_SPACE_ID = '22222222-2222-4222-8222-222222222222'

const mockUser = {
  id: 'user-1',
  email: 'owner@example.com',
  user_metadata: {} as Record<string, unknown>,
}

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let spaceMembershipResponse: { data: { role: string } | null }
let organizationResponse: { data: { name: string } | null }
let spaceResponse: { data: { name: string } | null }
let profileResponse: { data: { display_name: string } | null }
let rpcResponse: { data: Record<string, unknown> | null; error: { message: string } | null }

const sendInviteEmailMock = vi.fn(() => Promise.resolve({ success: true, messageId: 'msg-1' }))

vi.mock('@/lib/email', () => ({
  sendInviteEmail: (...args: unknown[]) => sendInviteEmailMock(...args),
}))

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
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(spaceMembershipResponse)),
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
      rpc: vi.fn(() => Promise.resolve(rpcResponse)),
    })
  ),
}))

const { POST } = await import('@/app/api/invites/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/invites', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const baseBody = {
  org_id: VALID_ORG_ID,
  space_id: VALID_SPACE_ID,
  email: 'invitee@example.com',
  role: 'member',
}

describe('POST /api/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authResponse = { data: { user: { ...mockUser, user_metadata: {} } } }
    orgMembershipResponse = { data: { role: 'owner' } }
    spaceMembershipResponse = { data: { role: 'admin' } }
    organizationResponse = { data: { name: 'テスト組織' } }
    spaceResponse = { data: { name: 'テストプロジェクト' } }
    profileResponse = { data: { display_name: 'プロフィール太郎' } }
    rpcResponse = {
      data: { invite_id: 'invite-1', token: 'tok-123', expires_at: '2026-08-01T00:00:00' },
      error: null,
    }
    sendInviteEmailMock.mockResolvedValue({ success: true, messageId: 'msg-1' })
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callPost(baseBody)

    expect(response.status).toBe(401)
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await callPost({ org_id: VALID_ORG_ID, space_id: VALID_SPACE_ID, role: 'member' })

    expect(response.status).toBe(400)
  })

  it('returns 400 when the message exceeds 500 characters', async () => {
    const response = await callPost({ ...baseBody, message: 'a'.repeat(501) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/500/)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('accepts a message of exactly 500 characters', async () => {
    const response = await callPost({ ...baseBody, message: 'a'.repeat(500) })

    expect(response.status).toBe(200)
  })

  it('returns 403 when the caller lacks org/space permission', async () => {
    orgMembershipResponse = { data: null }
    spaceMembershipResponse = { data: null }

    const response = await callPost(baseBody)

    expect(response.status).toBe(403)
  })

  it('returns the RPC error message when invite creation fails (e.g. plan limit)', async () => {
    rpcResponse = { data: null, error: { message: 'Organization has reached member limit. Please upgrade your plan.' } }

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Organization has reached member limit. Please upgrade your plan.')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('sends the invite email with the message and reports email_sent: true', async () => {
    const response = await callPost({ ...baseBody, message: 'よろしくお願いします' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.email_sent).toBe(true)
    expect(data.token).toBe('tok-123')
    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'よろしくお願いします' })
    )
  })

  it('prioritizes the profiles display_name for the inviter name', async () => {
    await callPost(baseBody)

    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: 'プロフィール太郎' })
    )
  })

  it('falls back to user_metadata.full_name when there is no profile display name', async () => {
    profileResponse = { data: null }
    authResponse = {
      data: { user: { ...mockUser, user_metadata: { full_name: 'メタデータ次郎' } } },
    }

    await callPost(baseBody)

    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: 'メタデータ次郎' })
    )
  })

  it('falls back to email, then 管理者, when neither profile nor metadata name exists', async () => {
    profileResponse = { data: null }
    authResponse = {
      data: { user: { ...mockUser, user_metadata: {}, email: 'owner@example.com' } },
    }

    await callPost(baseBody)

    expect(sendInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: 'owner@example.com' })
    )
  })

  it('reports email_sent: false when the email send fails, but still returns the invite', async () => {
    sendInviteEmailMock.mockRejectedValueOnce(new Error('Resend down'))

    const response = await callPost(baseBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.email_sent).toBe(false)
    expect(data.token).toBe('tok-123')
  })
})
