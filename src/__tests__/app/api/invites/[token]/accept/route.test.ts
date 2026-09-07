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
  role: 'member' as 'member' | 'client' | 'vendor',
  accepted_at: null as string | null,
  expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  created_by: 'inviter-1',
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
let authUserResponse: { data: { user: { id: string; email?: string } | null } }

const createUserMock = vi.fn(() => Promise.resolve(createUserResponse))
const adminRpcMock = vi.fn(() => Promise.resolve(acceptRpcResponse))
const inviteSingleMock = vi.fn(() => Promise.resolve(inviteSelectResponse))
const getUserMock = vi.fn(() => Promise.resolve(authUserResponse))
const rateLimitAllowedMock = vi.fn((..._args: unknown[]) => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 }))

let spaceSelectResponse: { data: { name: string } | null; error: { message: string } | null }
const spaceSingleMock = vi.fn(() => Promise.resolve(spaceSelectResponse))
let notificationsUpsertResponse: { error: { message: string } | null }
const notificationsUpsertMock = vi.fn(
  (_rows: Array<Record<string, unknown>>, _options: Record<string, unknown>) =>
    Promise.resolve(notificationsUpsertResponse),
)

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitAllowedMock(...args),
  getClientIp: () => '127.0.0.1',
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) }, 
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
      if (table === 'spaces') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: spaceSingleMock,
            })),
          })),
        }
      }
      if (table === 'notifications') {
        return {
          upsert: notificationsUpsertMock,
        }
      }
      return {}
    }),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) }, 
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
    spaceSelectResponse = { data: { name: 'PJ-A' }, error: null }
    notificationsUpsertResponse = { error: null }
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
    authUserResponse = { data: { user: { id: 'existing-user-1', email: baseInvite.email } } }

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
    authUserResponse = { data: { user: { id: 'existing-user-2', email: baseInvite.email } } }

    const response = await callPost(VALID_TOKEN)

    expect(response.status).toBe(200)
    expect(adminRpcMock).toHaveBeenCalledWith('rpc_accept_invite', {
      p_token: VALID_TOKEN,
      p_user_id: 'existing-user-2',
    })
  })

  it('returns 403 and does not consume the invite when the session user email does not match', async () => {
    authUserResponse = { data: { user: { id: 'other-user', email: 'other@example.com' } } }

    const response = await callPost(VALID_TOKEN)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toMatch(/別のメールアドレス宛/)
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('returns 403 (fail closed) when the session user has no email', async () => {
    authUserResponse = { data: { user: { id: 'no-email-user' } } }

    const response = await callPost(VALID_TOKEN)

    expect(response.status).toBe(403)
    expect(adminRpcMock).not.toHaveBeenCalled()
  })

  it('matches the invite email case-insensitively', async () => {
    authUserResponse = { data: { user: { id: 'existing-user-1', email: 'Invitee@Example.com' } } }

    const response = await callPost(VALID_TOKEN)

    expect(response.status).toBe(200)
    expect(adminRpcMock).toHaveBeenCalled()
  })

  // 受諾側は「招待された人」が見る画面。英語の例外をそのまま見せず、
  // 本人にできること（管理者に連絡）が分かる日本語にする。402=課金起因。
  it('人数枠に達していたら402＋日本語の案内＋code=member_limit_reached を返す', async () => {
    authUserResponse = { data: { user: { id: 'existing-user-1', email: baseInvite.email } } }
    acceptRpcResponse = { data: null, error: { message: 'Organization has reached member limit' } }

    const response = await callPost(VALID_TOKEN, {})
    const data = await response.json()

    expect(response.status).toBe(402)
    expect(data.code).toBe('member_limit_reached')
    expect(data.error).not.toMatch(/Organization has reached/)
  })

  it('人数枠以外のRPCエラーは従来どおり400でメッセージを返す', async () => {
    authUserResponse = { data: { user: { id: 'existing-user-1', email: baseInvite.email } } }
    acceptRpcResponse = { data: null, error: { message: 'invite expired' } }

    const response = await callPost(VALID_TOKEN, {})
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('invite expired')
  })

  it('returns 429 when the rate limit is exceeded', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 })

    const response = await callPost(VALID_TOKEN, { password: 'password123' })

    expect(response.status).toBe(429)
    expect(inviteSingleMock).not.toHaveBeenCalled()
  })

  describe('招待した人への承諾通知', () => {
    it('招待作成者と異なるユーザーが承諾したら、招待作成者へ in_app 通知を upsert(ignoreDuplicates) で作成する', async () => {
      authUserResponse = { data: { user: { id: 'existing-user-1', email: baseInvite.email } } }

      const response = await callPost(VALID_TOKEN, {})

      expect(response.status).toBe(200)
      expect(notificationsUpsertMock).toHaveBeenCalledTimes(1)
      const [rows, options] = notificationsUpsertMock.mock.calls[0] as [
        Array<Record<string, unknown>>,
        Record<string, unknown>,
      ]
      expect(options).toEqual({ onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        org_id: baseInvite.org_id,
        space_id: baseInvite.space_id,
        to_user_id: baseInvite.created_by,
        channel: 'in_app',
        type: 'invite_accepted',
      })
      const payload = rows[0].payload as Record<string, unknown>
      expect(payload.message).toContain(baseInvite.email)
      expect(payload.message).toContain('PJ-A')
      expect(payload.message).toContain('メンバー')
    })

    it('clientロールの招待が承諾されたら、通知本文に「相手先」と書く', async () => {
      inviteSelectResponse = { data: { ...baseInvite, role: 'client' }, error: null }
      acceptRpcResponse = { data: { org_id: 'org-1', space_id: 'space-1', role: 'client' }, error: null }
      authUserResponse = { data: { user: { id: 'existing-user-1', email: baseInvite.email } } }

      await callPost(VALID_TOKEN, {})

      const rows = notificationsUpsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
      const payload = rows[0].payload as Record<string, unknown>
      expect(payload.message).toContain('相手先')
    })

    it('vendorロールの招待が承諾されたら、通知本文に「ベンダー」と書く', async () => {
      inviteSelectResponse = { data: { ...baseInvite, role: 'vendor' }, error: null }
      acceptRpcResponse = { data: { org_id: 'org-1', space_id: 'space-1', role: 'vendor' }, error: null }
      authUserResponse = { data: { user: { id: 'existing-user-1', email: baseInvite.email } } }

      await callPost(VALID_TOKEN, {})

      const rows = notificationsUpsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
      const payload = rows[0].payload as Record<string, unknown>
      expect(payload.message).toContain('ベンダー')
    })

    it('招待作成者自身が承諾した場合は通知を作成しない', async () => {
      authUserResponse = { data: { user: { id: baseInvite.created_by, email: baseInvite.email } } }

      const response = await callPost(VALID_TOKEN, {})

      expect(response.status).toBe(200)
      expect(notificationsUpsertMock).not.toHaveBeenCalled()
    })

    it('通知の作成に失敗しても、承諾レスポンスは成功のまま返す', async () => {
      notificationsUpsertResponse = { error: { message: 'insert failed' } }
      authUserResponse = { data: { user: { id: 'existing-user-1', email: baseInvite.email } } }

      const response = await callPost(VALID_TOKEN, {})
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.org_id).toBe('org-1')
    })
  })
})
