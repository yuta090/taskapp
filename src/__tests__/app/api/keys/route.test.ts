import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/keys — org/space-scoped API key management.
 *
 * Security-critical: creation/listing/deletion of API keys must be gated by
 * org membership AND, for POST, space membership. DELETE must reject a key
 * whose org_id doesn't match the caller-supplied orgId (cross-org deletion).
 */

const ORG_ID = 'org-1'
const OTHER_ORG_ID = 'org-2'
const SPACE_ID = 'space-1'

const mockUser = { id: 'user-1' }

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let spaceMembershipResponse: { data: { id: string } | null }

let adminInsertResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let adminSelectSingleResponse: { data: { org_id: string } | null }
let adminDeleteResponse: { error: { message: string } | null }
let adminListResponse: { data: Record<string, unknown>[] | null; error: { message: string } | null }

const rateLimitAllowedMock = vi.fn((..._args: unknown[]) => ({
  allowed: true,
  remaining: 19,
  resetAt: Date.now() + 1000,
}))

const insertMock = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(adminInsertResponse)),
  })),
}))

const deleteEqOrgMock = vi.fn(() => Promise.resolve(adminDeleteResponse))
const deleteEqIdMock = vi.fn(() => ({ eq: deleteEqOrgMock }))
const deleteMock = vi.fn(() => ({ eq: deleteEqIdMock }))

const selectQueryMock = vi.fn((columns: string) => {
  // GET (list): .select(...).eq(orgId).eq(spaceId).order(...)
  if (columns.includes('name')) {
    return {
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve(adminListResponse)),
        })),
      })),
    }
  }
  // DELETE existing-key lookup: .select('org_id').eq(id).single()
  return {
    eq: vi.fn(() => ({
      single: vi.fn(() => Promise.resolve(adminSelectSingleResponse)),
    })),
  }
})

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitAllowedMock(...args),
  getClientIp: () => '127.0.0.1',
}))

// Session-scoped client: auth + org/space membership checks.
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
        return {}
      }),
    })
  ),
}))

// Admin (service-role) client: bypasses RLS for api_keys table access.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'api_keys') {
        return {
          insert: insertMock,
          select: selectQueryMock,
          delete: deleteMock,
        }
      }
      return {}
    }),
  })),
}))

const { POST, DELETE, GET } = await import('@/app/api/keys/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/keys', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function callDelete(params: Record<string, string>) {
  const url = new URL('/api/keys', 'http://localhost:3000')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const request = new NextRequest(url, { method: 'DELETE' })
  return DELETE(request)
}

function callGet(params: Record<string, string>) {
  const url = new URL('/api/keys', 'http://localhost:3000')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const request = new NextRequest(url, { method: 'GET' })
  return GET(request)
}

const basePostBody = {
  orgId: ORG_ID,
  spaceId: SPACE_ID,
  name: 'My Key',
  keyHash: 'hashed-value',
  keyPrefix: 'sk_live_ab',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'

  rateLimitAllowedMock.mockReturnValue({ allowed: true, remaining: 19, resetAt: Date.now() + 1000 })
  authResponse = { data: { user: mockUser } }
  orgMembershipResponse = { data: { role: 'owner' } }
  spaceMembershipResponse = { data: { id: 'space-membership-1' } }

  adminInsertResponse = {
    data: { id: 'key-1', org_id: ORG_ID, space_id: SPACE_ID, name: 'My Key' },
    error: null,
  }
  adminSelectSingleResponse = { data: { org_id: ORG_ID } }
  adminDeleteResponse = { error: null }
  adminListResponse = {
    data: [{ id: 'key-1', name: 'My Key', key_prefix: 'sk_live_ab' }],
    error: null,
  }
})

describe('POST /api/keys', () => {
  it('returns 429 when rate limited', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await callPost(basePostBody)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(401)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not a member of the org', async () => {
    orgMembershipResponse = { data: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller has no access to the specified space', async () => {
    spaceMembershipResponse = { data: null }

    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied to this space')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('creates the key and scopes created_by to the authenticated user', async () => {
    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(adminInsertResponse.data)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, space_id: SPACE_ID, created_by: mockUser.id })
    )
  })

  it('returns a generic 500 (no internal error detail) when insert fails', async () => {
    adminInsertResponse = { data: null, error: { message: 'duplicate key value violates unique constraint' } }

    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to create API key')
    expect(data.error).not.toContain('constraint')
  })
})

describe('DELETE /api/keys', () => {
  it('returns 429 when rate limited', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(429)
  })

  it('returns 400 when id or orgId is missing', async () => {
    const response = await callDelete({ id: 'key-1' })

    expect(response.status).toBe(400)
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(401)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not a member of the org', async () => {
    orgMembershipResponse = { data: null }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the key does not exist', async () => {
    adminSelectSingleResponse = { data: null }

    const response = await callDelete({ id: 'missing-key', orgId: ORG_ID })

    expect(response.status).toBe(404)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 403 and does not delete when the key belongs to a different org (cross-org deletion attempt)', async () => {
    adminSelectSingleResponse = { data: { org_id: OTHER_ORG_ID } }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes the key when it belongs to the caller org', async () => {
    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(deleteMock).toHaveBeenCalled()
    expect(deleteEqIdMock).toHaveBeenCalledWith('id', 'key-1')
    expect(deleteEqOrgMock).toHaveBeenCalledWith('org_id', ORG_ID)
  })
})

describe('GET /api/keys', () => {
  it('returns 429 when rate limited', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(429)
  })

  it('returns 400 when orgId or spaceId is missing', async () => {
    const response = await callGet({ orgId: ORG_ID })

    expect(response.status).toBe(400)
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(401)
  })

  it('returns 403 when the caller is not a member of the org', async () => {
    orgMembershipResponse = { data: null }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(403)
  })

  it('lists keys for the org/space without leaking key_hash', async () => {
    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(adminListResponse.data)
    expect(selectQueryMock).toHaveBeenCalledWith(expect.not.stringContaining('key_hash'))
  })
})
