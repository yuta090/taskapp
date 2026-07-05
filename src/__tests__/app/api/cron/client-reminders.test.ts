import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/cron/client-reminders is invoked by pg_cron (via pg_net) three times a
 * day with a Bearer CRON_SECRET. It must reject anything else, and must never
 * touch the database or send email without a valid secret.
 */

const sendReminderEmailMock = vi.fn(() => Promise.resolve({ success: true }))
vi.mock('@/lib/email/reminder', () => ({
  sendReminderEmail: (...args: unknown[]) => sendReminderEmailMock(...args),
}))

let tasksResponse: { data: unknown[] | null; error: null | { message: string } }

const adminFromMock = vi.fn((table: string) => {
  if (table === 'tasks') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve(tasksResponse)),
          })),
        })),
      })),
    }
  }
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
      in: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: adminFromMock,
    auth: { admin: { getUserById: vi.fn(() => Promise.resolve({ data: { user: null } })) } },
  })),
}))

const { POST } = await import('@/app/api/cron/client-reminders/route')

function callPost(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const request = new NextRequest(new URL('/api/cron/client-reminders', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('POST /api/cron/client-reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasksResponse = { data: [], error: null }
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const response = await callPost({ authorization: 'Bearer anything' })
    expect(response.status).toBe(500)
    expect(sendReminderEmailMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const response = await callPost()
    expect(response.status).toBe(401)
    expect(sendReminderEmailMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the token does not match CRON_SECRET', async () => {
    const response = await callPost({ authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
    expect(sendReminderEmailMock).not.toHaveBeenCalled()
  })

  it('returns 200 with an empty plan when there are no target tasks', async () => {
    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.digestCount).toBe(0)
    expect(data.emailsSent).toBe(0)
    expect(sendReminderEmailMock).not.toHaveBeenCalled()
  })

  it('supports dryRun without sending any email', async () => {
    const response = await callPost({ authorization: 'Bearer test-cron-secret' }, { dryRun: true })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.dryRun).toBe(true)
    expect(sendReminderEmailMock).not.toHaveBeenCalled()
  })
})
