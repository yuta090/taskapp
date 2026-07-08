import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111'

const mockUser = { id: 'user-1', email: 'owner@example.com' }

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let pendingInvitesResponse: { data: Record<string, unknown>[] | null; error: { message: string } | null }

const orderMock = vi.fn(() => Promise.resolve(pendingInvitesResponse))
const invitesQueryChain = {
  select: vi.fn(function (this: unknown) { return this }),
  eq: vi.fn(function (this: unknown) { return this }),
  is: vi.fn(function (this: unknown) { return this }),
  gt: vi.fn(function (this: unknown) { return this }),
  order: orderMock,
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
        return {}
      }),
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'invites') return invitesQueryChain
      return {}
    }),
  })),
}))

const { GET } = await import('@/app/api/invites/pending/route')

function callGet(orgId?: string) {
  const url = new URL('/api/invites/pending', 'http://localhost:3000')
  if (orgId !== undefined) url.searchParams.set('org_id', orgId)
  const request = new NextRequest(url)
  return GET(request)
}

describe('GET /api/invites/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    orgMembershipResponse = { data: { role: 'owner' } }
    pendingInvitesResponse = {
      data: [
        {
          id: 'invite-1',
          email: 'invitee@example.com',
          role: 'member',
          space_id: 'space-1',
          created_at: '2026-07-01T00:00:00Z',
          expires_at: '2026-09-29T00:00:00Z',
          spaces: { name: 'テストプロジェクト' },
        },
      ],
      error: null,
    }
    orderMock.mockImplementation(() => Promise.resolve(pendingInvitesResponse))
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callGet(VALID_ORG_ID)

    expect(response.status).toBe(401)
  })

  it('returns 400 when org_id is missing or malformed', async () => {
    const missing = await callGet()
    expect(missing.status).toBe(400)

    const malformed = await callGet('not-a-uuid')
    expect(malformed.status).toBe(400)
  })

  it('accepts non-v4 but well-formed UUIDs (demo org id regression)', async () => {
    // v4限定regexがデモ組織ID(非v4)を400で弾いていた回帰テスト
    const response = await callGet('00000000-0000-0000-0000-000000000001')

    expect(response.status).toBe(200)
  })

  it('returns 403 when the caller is not the org owner', async () => {
    orgMembershipResponse = { data: { role: 'member' } }

    const response = await callGet(VALID_ORG_ID)

    expect(response.status).toBe(403)
  })

  it('returns 403 when the caller has no org membership at all', async () => {
    orgMembershipResponse = { data: null }

    const response = await callGet(VALID_ORG_ID)

    expect(response.status).toBe(403)
  })

  it('returns the pending invites list with space names for the org owner', async () => {
    const response = await callGet(VALID_ORG_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invites).toEqual([
      {
        id: 'invite-1',
        email: 'invitee@example.com',
        role: 'member',
        space_id: 'space-1',
        space_name: 'テストプロジェクト',
        created_at: '2026-07-01T00:00:00Z',
        expires_at: '2026-09-29T00:00:00Z',
      },
    ])
  })

  it('filters to accepted_at is null and expires_at > now via query builder', async () => {
    await callGet(VALID_ORG_ID)

    expect(invitesQueryChain.eq).toHaveBeenCalledWith('org_id', VALID_ORG_ID)
    expect(invitesQueryChain.is).toHaveBeenCalledWith('accepted_at', null)
    expect(invitesQueryChain.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
  })
})
