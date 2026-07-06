import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/push/subscribe
 *
 * Regression: `push_subscriptions.endpoint` is globally UNIQUE and RLS only
 * allows `user_id = auth.uid()` to update a row. Previously the browser
 * upserted directly (onConflict: 'endpoint'), so once a shared browser's
 * endpoint was owned by one user, no other user could ever subscribe from
 * that same browser (RLS blocks the update) and logging out never freed the
 * row. This route runs with service_role so it can transfer ownership: if
 * the endpoint already belongs to a different user, delete that row first,
 * then upsert it under the current session's user_id.
 */

let getUserResponse: { data: { user: { id: string } | null } }

const getUserMock = vi.fn(() => Promise.resolve(getUserResponse))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: getUserMock },
    })
  ),
}))

const deleteNeqMock = vi.fn(() => Promise.resolve({ error: null }))
const deleteEqMock = vi.fn(() => ({ neq: deleteNeqMock }))
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))
const upsertMock = vi.fn(() => Promise.resolve({ error: null as { message: string } | null }))

const adminFromMock = vi.fn((table: string) => {
  if (table === 'push_subscriptions') {
    return {
      delete: deleteMock,
      upsert: upsertMock,
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFromMock })),
}))

const { POST } = await import('@/app/api/push/subscribe/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/push/subscribe', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const validBody = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
  userAgent: 'test-agent',
}

describe('POST /api/push/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserResponse = { data: { user: { id: 'user-1' } } }
  })

  it('returns 401 when there is no session', async () => {
    getUserResponse = { data: { user: null } }

    const response = await callPost(validBody)

    expect(response.status).toBe(401)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when endpoint or keys are missing', async () => {
    const response = await callPost({ endpoint: 'https://push.example/abc' })

    expect(response.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('transfers ownership: deletes any existing row for the endpoint owned by a different user, then upserts under the current user', async () => {
    const response = await callPost(validBody)

    expect(response.status).toBe(200)

    // Ownership transfer: delete rows for this endpoint NOT owned by the current user
    expect(deleteMock).toHaveBeenCalled()
    expect(deleteEqMock).toHaveBeenCalledWith('endpoint', 'https://push.example/abc')
    expect(deleteNeqMock).toHaveBeenCalledWith('user_id', 'user-1')

    // Insert/update under the current session's user_id
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        endpoint: 'https://push.example/abc',
        p256dh: 'p256dh-value',
        auth: 'auth-value',
        user_agent: 'test-agent',
      }),
      { onConflict: 'endpoint' }
    )
  })

  it('runs the ownership-transfer delete before the upsert', async () => {
    const callOrder: string[] = []
    deleteNeqMock.mockImplementation(() => {
      callOrder.push('delete')
      return Promise.resolve({ error: null })
    })
    upsertMock.mockImplementation(() => {
      callOrder.push('upsert')
      return Promise.resolve({ error: null })
    })

    await callPost(validBody)

    expect(callOrder).toEqual(['delete', 'upsert'])
  })

  it('returns 500 when the upsert fails', async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: 'DB error' } })

    const response = await callPost(validBody)

    expect(response.status).toBe(500)
  })
})
