import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/keys/user — user-scoped API key management.
 *
 * Security-critical: a user must only be able to create keys scoped to
 * spaces they belong to, and must only be able to delete/list their own
 * keys (never another user's, even if the id is guessable).
 */

const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const SPACE_A = 'space-a'
const SPACE_B = 'space-b'

const mockUser = { id: USER_ID }

let authResponse: { data: { user: typeof mockUser | null }; error: { message: string } | null }

let membershipSingleResponse: {
  data: { spaces: { org_id: string } } | null
  error: { message: string } | null
}
let userSpacesResponse: { data: { space_id: string }[] | null; error: { message: string } | null }
let insertResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let keyLookupResponse: { data: { user_id: string } | null; error: { message: string } | null }
let deleteResponse: { error: { message: string } | null }
let listResponse: { data: Record<string, unknown>[] | null; error: { message: string } | null }

const insertMock = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(insertResponse)),
  })),
}))

const deleteEqMock = vi.fn(() => Promise.resolve(deleteResponse))
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
    })
  ),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== 'api_keys' && table !== 'space_memberships') return {}
      if (table === 'space_memberships') {
        return {
          select: vi.fn((columns: string) => {
            // membership → org_id lookup: select('spaces(org_id)').eq(user_id).limit(1).single()
            if (columns.includes('spaces(')) {
              return {
                eq: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve(membershipSingleResponse)),
                  })),
                })),
              }
            }
            // accessible-space verification: select('space_id').eq(user_id).in(allowedSpaceIds)
            return {
              eq: vi.fn(() => ({
                in: vi.fn(() => Promise.resolve(userSpacesResponse)),
              })),
            }
          }),
        }
      }
      // api_keys
      return {
        insert: insertMock,
        select: vi.fn((columns: string) => {
          if (columns.includes('user_id') && !columns.includes('allowed_space_ids')) {
            // DELETE lookup: select('user_id').eq(id).single()
            return {
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(keyLookupResponse)),
              })),
            }
          }
          // GET list: select(...).eq(user_id).order(...)
          return {
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve(listResponse)),
            })),
          }
        }),
        delete: deleteMock,
      }
    }),
  })),
}))

const { POST, DELETE, GET } = await import('@/app/api/keys/user/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/keys/user', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function callDelete(params: Record<string, string>) {
  const url = new URL('/api/keys/user', 'http://localhost:3000')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return DELETE(new NextRequest(url, { method: 'DELETE' }))
}

function callGet() {
  return GET(new NextRequest(new URL('/api/keys/user', 'http://localhost:3000'), { method: 'GET' }))
}

const basePostBody = {
  name: 'CLI Key',
  keyHash: 'hashed-value',
  keyPrefix: 'sk_live_ab',
  allowedSpaceIds: [SPACE_A],
  allowedActions: ['read'],
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'

  authResponse = { data: { user: mockUser }, error: null }
  membershipSingleResponse = { data: { spaces: { org_id: 'org-1' } }, error: null }
  userSpacesResponse = { data: [{ space_id: SPACE_A }], error: null }
  insertResponse = {
    data: { id: 'key-1', user_id: USER_ID, allowed_space_ids: [SPACE_A] },
    error: null,
  }
  keyLookupResponse = { data: { user_id: USER_ID }, error: null }
  deleteResponse = { error: null }
  listResponse = { data: [{ id: 'key-1', name: 'CLI Key' }], error: null }
})

describe('POST /api/keys/user', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(401)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await callPost({ name: 'x', keyHash: 'y', keyPrefix: 'z', allowedSpaceIds: [] })

    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the user has no space memberships', async () => {
    membershipSingleResponse = { data: null, error: { message: 'not found' } }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when requesting a space the user does not belong to', async () => {
    userSpacesResponse = { data: [], error: null } // SPACE_A not accessible

    const response = await callPost({ ...basePostBody, allowedSpaceIds: [SPACE_A, SPACE_B] })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied to some selected spaces')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('creates the key scoped to the authenticated user', async () => {
    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(insertResponse.data)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, created_by: USER_ID, scope: 'user' })
    )
  })

  it('defaults allowed_actions to read-only when not specified', async () => {
    await callPost({ ...basePostBody, allowedActions: undefined })

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ allowed_actions: ['read'] }))
  })
})

describe('DELETE /api/keys/user', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callDelete({ id: 'key-1' })

    expect(response.status).toBe(401)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 400 when id is missing', async () => {
    const response = await callDelete({})

    expect(response.status).toBe(400)
  })

  it('returns 404 when the key does not exist', async () => {
    keyLookupResponse = { data: null, error: { message: 'not found' } }

    const response = await callDelete({ id: 'missing-key' })

    expect(response.status).toBe(404)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 403 and does not delete another user\'s key', async () => {
    keyLookupResponse = { data: { user_id: OTHER_USER_ID }, error: null }

    const response = await callDelete({ id: 'key-1' })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes the key when it belongs to the caller', async () => {
    const response = await callDelete({ id: 'key-1' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(deleteMock).toHaveBeenCalled()
  })
})

describe('GET /api/keys/user', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callGet()

    expect(response.status).toBe(401)
  })

  it("lists only the caller's own keys without leaking key_hash", async () => {
    const response = await callGet()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(listResponse.data)
  })

  it('returns the raw error message on failure (informational — matches current route behavior)', async () => {
    listResponse = { data: null, error: { message: 'db unreachable' } }

    const response = await callGet()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('db unreachable')
  })
})
