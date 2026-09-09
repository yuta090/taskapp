import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const VALID_ORG_ID = '11111111-1111-4111-8111-111111111111'
const VALID_SPACE_ID = '22222222-2222-4222-8222-222222222222'

const mockUser = { id: 'user-1', email: 'owner@example.com' }

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let spaceMembershipResponse: { data: { role: string } | null }
let spaceResponse: { data: { org_id: string } | null }
let pendingInvitesResponse: { data: Record<string, unknown>[] | null; error: { message: string } | null }

const orderMock = vi.fn(() => Promise.resolve(pendingInvitesResponse))
const invitesQueryChain = {
  select: vi.fn(function (this: unknown) { return this }),
  eq: vi.fn(function (this: unknown) { return this }),
  is: vi.fn(function (this: unknown) { return this }),
  gt: vi.fn(function (this: unknown) { return this }),
  order: orderMock,
  limit: vi.fn(() => Promise.resolve(pendingInvitesResponse)),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) }, 
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
        if (table === 'spaces') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve(spaceResponse)) })),
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

function callGetSpace(spaceId: string, status?: string) {
  const url = new URL('/api/invites/pending', 'http://localhost:3000')
  url.searchParams.set('space_id', spaceId)
  if (status) url.searchParams.set('status', status)
  return GET(new NextRequest(url))
}

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
        invitee_name: null,
        role: 'member',
        space_id: 'space-1',
        space_name: 'テストプロジェクト',
        created_at: '2026-07-01T00:00:00Z',
        expires_at: '2026-09-29T00:00:00Z',
        accepted_at: null,
        status: 'pending',
      },
    ])
    expect(data.can_manage).toBe(true)
  })

  it('filters to accepted_at is null and expires_at > now via query builder', async () => {
    await callGet(VALID_ORG_ID)

    expect(invitesQueryChain.eq).toHaveBeenCalledWith('org_id', VALID_ORG_ID)
    expect(invitesQueryChain.is).toHaveBeenCalledWith('accepted_at', null)
    expect(invitesQueryChain.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
  })
})

describe('GET /api/invites/pending — プロジェクト単位', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    orgMembershipResponse = { data: { role: 'member' } }
    spaceMembershipResponse = { data: { role: 'admin' } }
    spaceResponse = { data: { org_id: VALID_ORG_ID } }
    pendingInvitesResponse = { data: [], error: null }
  })

  it('プロジェクトの管理者なら、事務所のオーナーでなくても一覧を見られる', async () => {
    const response = await callGetSpace(VALID_SPACE_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(invitesQueryChain.eq).toHaveBeenCalledWith('space_id', VALID_SPACE_ID)
    // プロジェクトの管理者なので、取り消し・再送もできる
    expect(data.can_manage).toBe(true)
  })

  it('事務所のオーナーなら取り消し・再送もできると返す', async () => {
    orgMembershipResponse = { data: { role: 'owner' } }

    const data = await (await callGetSpace(VALID_SPACE_ID)).json()

    expect(data.can_manage).toBe(true)
  })

  it('編集者は一覧は見られるが、取り消し・再送はできない', async () => {
    spaceMembershipResponse = { data: { role: 'editor' } }

    const response = await callGetSpace(VALID_SPACE_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.can_manage).toBe(false)
  })

  it('status=all のときは承諾済み・期限切れも含めて返す（絞り込まない）', async () => {
    await callGetSpace(VALID_SPACE_ID, 'all')

    expect(invitesQueryChain.is).not.toHaveBeenCalled()
    expect(invitesQueryChain.gt).not.toHaveBeenCalled()
    expect(invitesQueryChain.limit).toHaveBeenCalledWith(100)
  })

  it('プロジェクトの閲覧者は見られない', async () => {
    spaceMembershipResponse = { data: { role: 'viewer' } }

    expect((await callGetSpace(VALID_SPACE_ID)).status).toBe(403)
  })

  it('事務所に属していなければ見られない', async () => {
    orgMembershipResponse = { data: null }

    expect((await callGetSpace(VALID_SPACE_ID)).status).toBe(403)
  })

  it('存在しないプロジェクトなら404', async () => {
    spaceResponse = { data: null }

    expect((await callGetSpace(VALID_SPACE_ID)).status).toBe(404)
  })
})
