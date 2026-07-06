import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/push/unsubscribe
 *
 * Requires a session and deletes only the caller's own row for the given
 * endpoint (explicit user_id filter, not relying solely on RLS, since this
 * route uses service_role like /api/push/subscribe).
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

const deleteEqEqMock = vi.fn(() => Promise.resolve({ error: null as { message: string } | null }))
const deleteEqMock = vi.fn(() => ({ eq: deleteEqEqMock }))
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))

const adminFromMock = vi.fn((table: string) => {
  if (table === 'push_subscriptions') {
    return { delete: deleteMock }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFromMock })),
}))

const { POST } = await import('@/app/api/push/unsubscribe/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/push/unsubscribe', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('POST /api/push/unsubscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserResponse = { data: { user: { id: 'user-1' } } }
  })

  it('returns 401 when there is no session', async () => {
    getUserResponse = { data: { user: null } }

    const response = await callPost({ endpoint: 'https://push.example/abc' })

    expect(response.status).toBe(401)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 400 when endpoint is missing', async () => {
    const response = await callPost({})

    expect(response.status).toBe(400)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes only the current user\'s row for the given endpoint', async () => {
    const response = await callPost({ endpoint: 'https://push.example/abc' })

    expect(response.status).toBe(200)
    expect(deleteMock).toHaveBeenCalled()
    expect(deleteEqMock).toHaveBeenCalledWith('endpoint', 'https://push.example/abc')
    expect(deleteEqEqMock).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 500 when the delete fails', async () => {
    deleteEqEqMock.mockResolvedValueOnce({ error: { message: 'DB error' } })

    const response = await callPost({ endpoint: 'https://push.example/abc' })

    expect(response.status).toBe(500)
  })
})
