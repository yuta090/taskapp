import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/push/dispatch is invoked by the notifications_push_dispatch DB trigger
 * (via pg_net) with a Bearer CRON_SECRET, mirroring /api/cron/client-reminders.
 * It must reject anything else, and must never call web-push without a valid
 * secret or without VAPID configured.
 */

const sendNotificationMock = vi.fn((..._args: unknown[]) => Promise.resolve())
const setVapidDetailsMock = vi.fn()
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}))

type TableResponses = {
  notifications: { data: unknown; error: null | { message: string } }
  org_memberships: { data: unknown; error: null | { message: string } }
  push_subscriptions: { data: unknown[] | null; error: null | { message: string } }
}

let responses: TableResponses

const deleteMock = vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ error: null })) }))
const updateMock = vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ error: null })) }))

const adminFromMock = vi.fn((table: string) => {
  if (table === 'notifications') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve(responses.notifications)),
        })),
      })),
    }
  }
  if (table === 'org_memberships') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve(responses.org_memberships)),
          })),
        })),
      })),
    }
  }
  if (table === 'push_subscriptions') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve(responses.push_subscriptions)),
      })),
      delete: deleteMock,
      update: updateMock,
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFromMock })),
}))

const { POST } = await import('@/app/api/push/dispatch/route')

function callPost(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const request = new NextRequest(new URL('/api/push/dispatch', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('POST /api/push/dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key'
    process.env.VAPID_PRIVATE_KEY = 'test-private-key'
    process.env.VAPID_SUBJECT = 'mailto:test@example.com'

    responses = {
      notifications: {
        data: {
          id: 'notif-1',
          org_id: 'org-1',
          space_id: 'space-1',
          to_user_id: 'user-1',
          type: 'ball_passed',
          payload: {},
        },
        error: null,
      },
      org_memberships: { data: { role: 'member' }, error: null },
      push_subscriptions: { data: [], error: null },
    }
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const response = await callPost({ authorization: 'Bearer anything' }, { notificationId: 'notif-1' })
    expect(response.status).toBe(500)
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const response = await callPost({}, { notificationId: 'notif-1' })
    expect(response.status).toBe(401)
  })

  it('returns 401 when the token does not match CRON_SECRET', async () => {
    const response = await callPost({ authorization: 'Bearer wrong-token' }, { notificationId: 'notif-1' })
    expect(response.status).toBe(401)
  })

  it('returns 400 when notificationId is missing', async () => {
    const response = await callPost({ authorization: 'Bearer test-cron-secret' }, {})
    expect(response.status).toBe(400)
  })

  it('returns 500 when VAPID is not configured', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    const response = await callPost({ authorization: 'Bearer test-cron-secret' }, { notificationId: 'notif-1' })
    expect(response.status).toBe(500)
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the notification does not exist', async () => {
    responses.notifications = { data: null, error: null }
    const response = await callPost({ authorization: 'Bearer test-cron-secret' }, { notificationId: 'notif-1' })
    expect(response.status).toBe(404)
  })

  it('returns sent:0 when there are no subscriptions for the user', async () => {
    const response = await callPost({ authorization: 'Bearer test-cron-secret' }, { notificationId: 'notif-1' })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({ sent: 0, failed: 0, removed: 0 })
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('sends to every subscription and updates last_used_at on success', async () => {
    responses.push_subscriptions = {
      data: [{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' }],
      error: null,
    }

    const response = await callPost({ authorization: 'Bearer test-cron-secret' }, { notificationId: 'notif-1' })
    const data = await response.json()

    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      'mailto:test@example.com',
      'test-public-key',
      'test-private-key'
    )
    expect(sendNotificationMock).toHaveBeenCalledTimes(1)
    expect(data).toEqual({ sent: 1, failed: 0, removed: 0 })
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ last_used_at: expect.any(String) }))
  })

  it('removes stale subscriptions that fail with a 410 Gone status', async () => {
    responses.push_subscriptions = {
      data: [{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' }],
      error: null,
    }
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }))

    const response = await callPost({ authorization: 'Bearer test-cron-secret' }, { notificationId: 'notif-1' })
    const data = await response.json()

    expect(data).toEqual({ sent: 0, failed: 1, removed: 1 })
    expect(deleteMock).toHaveBeenCalled()
  })

  it('resolves the recipient role from org_memberships to pick the deep link target', async () => {
    responses.org_memberships = { data: { role: 'client' }, error: null }
    responses.notifications = {
      data: {
        id: 'notif-1',
        org_id: 'org-1',
        space_id: 'space-1',
        to_user_id: 'user-1',
        type: 'ball_passed',
        payload: { task_id: 'task-9' },
      },
      error: null,
    }
    responses.push_subscriptions = {
      data: [{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' }],
      error: null,
    }

    await callPost({ authorization: 'Bearer test-cron-secret' }, { notificationId: 'notif-1' })

    const payloadArg = (sendNotificationMock.mock.calls[0] as unknown as [unknown, string])[1]
    const parsed = JSON.parse(payloadArg)
    expect(parsed.url).toBe('/portal/task/task-9')
  })
})
