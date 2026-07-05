import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/invites/[token]/accept
 *
 * Server-side invite acceptance. Replaces the client-calling
 * `rpc_accept_invite` (anon-executable) with a service_role-only flow so
 * that a caller can never supply an arbitrary p_user_id — see
 * supabase/migrations/20260704161919_rpc_authz_org_invite.sql (残存リスク).
 */

const VALID_TOKEN = 'a'.repeat(32)

const baseInvite = {
  id: 'invite-1',
  org_id: 'org-1',
  space_id: 'space-1',
  email: 'invitee@example.com',
  role: 'member' as const,
  accepted_at: null as string | null,
  expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
}

let inviteSelectResponse: {
  data: typeof baseInvite | null
  error: { message: string } | null
}
let createUserResponse: {
  data: { user: { id: string } | null }
  error: { message: string } | null
}
let acceptRpcResponse: {
  data: { org_id: string; space_id: string; role: string } | null
  error: { message: string } | null
}
let authUserResponse: { data: { user: { id: string } | null } }

const createUserMock = vi.fn(() => Promise.resolve(createUserResponse))
const adminRpcMock = vi.fn(() => Promise.resolve(acceptRpcResponse))
const inviteSingleMock = vi.fn(() => Promise.resolve(inviteSelectResponse))
const getUserMock = vi.fn(() => Promise.resolve(authUserResponse))
const rateLimitAllowedMock = vi.fn(() => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 }))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitAllowedMock(...args),
  getClientIp: () => '127.0.0.1',
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: getUserMock,
      },
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'invites') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: inviteSingleMock,
            })),
          })),
        }
      }
      return {}
    }),
    auth: {
      admin: {
        createUser: createUserMock,
      },
    },
    rpc: adminRpcMock,
  })),
}))

const { POST } = await import('@/app/api/invites/[token]/accept/route')

function callPost(token: string, body?: Record<string, unknown>) {
  const request = new NextRequest(new URL(`/api/invites/${token}/accept`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ token }) })
}

describe('POST /api/invites/[token]/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAllowedMock.mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 })

    inviteSelectResponse = { data: { ...baseInvite }, error: null }
    authUserResponse = { data: { user: null } }
    createUserResponse = { data: { user: { id: 'new-user-1' } }, error: null }
    acceptRpcResponse = {
      data: { org_id: 'org-1', space_id: 'space-1', role: 'member' },
      error: null,
    }
  })

  it('returns 404 when the token does not match any invite', async () => {
    inviteSelectResponse = { data: null, error: { message: 'not found' } }

    const response = await callPost(VALID_TOKEN, { password: 'password123' })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toMatch(/無効|期限切れ/)
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the invite is already accepted', async () => {
    inviteSelectResponse = { data: { ...baseInvite, accepted_at: '2026-01-01T00:00:00.000Z' }, error: null }

    const response = await callPost(VALID_TOKEN, { password: 'password123' })

    expect(response.status).toBe(404)
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the invite has expired', async () => {
    inviteSelectResponse = {
      data: { ...baseInvite, expires_at: new Date(Date.now() - 1000).toISOString() },
      error: null,
    }

    const response = await callPost(VALID_TOKEN, { password: 'password123' })

    expect(response.status).toBe(404)
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('returns 400 when there is no session and no password is supplied', async () => {
    const response = await callPost(VALID_TOKEN, {})

    expect(response.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the supplied password is too short', async () => {
    const response = await callPost(VALID_TOKEN, { password: 'short' })

    expect(response.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('ignores an email field in the request body and always uses the invite email', async () => {
    await callPost(VALID_TOKEN, { password: 'password123', email: 'attacker@example.com' })

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: baseInvite.email })
    )
    expect(createUserMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: 'attacker@example.com' })
    )
  })

  it('returns 409 when the account already exists', async () => {
    createUserResponse = { data: { user: null }, error: { message: 'User already registered' } }

    const response = await callPost(VALID_TOKEN, { password: 'password123' })

    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.error).toMatch(/既にアカウント/)
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('returns 500 (not 409) when user creation fails for a non-existing-account reason', async () => {
    createUserResponse = { data: { user: null }, error: { message: 'Database connection error' } }

    const response = await callPost(VALID_TOKEN, { password: 'password123' })

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).not.toMatch(/既にアカウント/)
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('creates a new user and accepts the invite for the new user id when there is no session', async () => {
    const response = await callPost(VALID_TOKEN, { password: 'password123' })
    const data = await response.json()

    expect(createUserMock).toHaveBeenCalledWith({
      email: baseInvite.email,
      password: 'password123',
      email_confirm: true,
    })
    expect(adminRpcMock).toHaveBeenCalledWith('rpc_accept_invite', {
      p_token: VALID_TOKEN,
      p_user_id: 'new-user-1',
    })
    expect(response.status).toBe(200)
    expect(data).toEqual({
      org_id: 'org-1',
      space_id: 'space-1',
      role: 'member',
      email: baseInvite.email,
      created: true,
    })
  })

  it('accepts the invite for the existing session user without requiring a password', async () => {
    authUserResponse = { data: { user: { id: 'existing-user-1' } } }

    const response = await callPost(VALID_TOKEN, {})
    const data = await response.json()

    expect(createUserMock).not.toHaveBeenCalled()
    expect(adminRpcMock).toHaveBeenCalledWith('rpc_accept_invite', {
      p_token: VALID_TOKEN,
      p_user_id: 'existing-user-1',
    })
    expect(response.status).toBe(200)
    expect(data.created).toBe(false)
  })

  it('handles a missing request body (auto-accept path) when a session exists', async () => {
    authUserResponse = { data: { user: { id: 'existing-user-2' } } }

    const response = await callPost(VALID_TOKEN)

    expect(response.status).toBe(200)
    expect(adminRpcMock).toHaveBeenCalledWith('rpc_accept_invite', {
      p_token: VALID_TOKEN,
      p_user_id: 'existing-user-2',
    })
  })

  it('returns 400 with the RPC error message when rpc_accept_invite fails', async () => {
    authUserResponse = { data: { user: { id: 'existing-user-1' } } }
    acceptRpcResponse = { data: null, error: { message: 'Organization has reached member limit' } }

    const response = await callPost(VALID_TOKEN, {})
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Organization has reached member limit')
  })

  it('returns 429 when the rate limit is exceeded', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 })

    const response = await callPost(VALID_TOKEN, { password: 'password123' })

    expect(response.status).toBe(429)
    expect(inviteSingleMock).not.toHaveBeenCalled()
  })
})
