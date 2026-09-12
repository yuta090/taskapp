import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EMAIL_SEND_RATE_LIMIT } from '@/lib/email/sendRateLimit'

/**
 * POST /api/cron/notification-digest は、対象者が多くても Resend の送信回数の上限
 * （1秒あたりの回数）に合わせて、一斉に送らず間隔を空けて送る。
 */

const CRON_SECRET = 'test-secret'
process.env.CRON_SECRET = CRON_SECRET

const { concurrency } = EMAIL_SEND_RATE_LIMIT

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'gt', 'lte', 'is', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (resolve: any, reject?: any) => Promise.resolve(response).then(resolve, reject)
  return builder
}

// concurrency件を最初のかたまりで使い切り、+1人ぶんを次のかたまりに残す
const USERS = Array.from({ length: concurrency + 1 }, (_, i) => `user-${i}`)

function basePrefRow(userId: string) {
  return {
    user_id: userId,
    email_enabled: true,
    on_task_assigned: true,
    on_task_mentioned: true,
    on_review_request: true,
    on_client_response: true,
    on_meeting_reminder: true,
    digest_frequency: 'daily',
    last_digest_sent_at: null,
  }
}

const prefsUpsertCalls: unknown[][] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'notification_email_prefs') {
        const builder = chain({ data: USERS.map(basePrefRow), error: null })
        builder.update = vi.fn(() => chain({ data: null, error: null }))
        builder.upsert = vi.fn((rows: unknown[]) => {
          prefsUpsertCalls.push(rows)
          return chain({ data: null, error: null })
        })
        return builder
      }
      if (table === 'notifications') {
        return chain({
          data: USERS.map((u) => ({
            to_user_id: u,
            type: 'task_assigned',
            payload: { title: 'タスク' },
            space_id: 'space-1',
            created_at: new Date().toISOString(),
          })),
          error: null,
        })
      }
      if (table === 'spaces') return chain({ data: [{ id: 'space-1', name: 'PJ' }], error: null })
      if (table === 'profiles') return chain({ data: USERS.map((u) => ({ id: u, display_name: u })), error: null })
      if (table === 'org_memberships') return chain({ data: [], error: null })
      if (table === 'invites') return chain({ data: [], error: null })
      throw new Error(`Unexpected admin table: ${table}`)
    }),
    auth: {
      admin: {
        getUserById: vi.fn((id: string) => Promise.resolve({ data: { user: { email: `${id}@example.com` } } })),
      },
    },
  })),
}))

const sendDigestEmailMock = vi.fn((_params: Record<string, unknown>) =>
  Promise.resolve({ success: true, messageId: 'msg-1' }),
)
vi.mock('@/lib/email/notificationDigest', () => ({
  sendNotificationDigestEmail: (params: Record<string, unknown>) => sendDigestEmailMock(params),
}))

const { POST } = await import('@/app/api/cron/notification-digest/route')

function callPost() {
  const request = new NextRequest(new URL('/api/cron/notification-digest', 'http://localhost:3000'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return POST(request)
}

describe('POST /api/cron/notification-digest — 送信は一斉に投げず間隔を空ける', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prefsUpsertCalls.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it(`${USERS.length}人いても、最初はconcurrency(${concurrency})人ぶんだけ送り、残りは間隔を空けてから送る`, async () => {
    const promise = callPost()

    // 最初のひとかたまり（concurrency件）が捌けるまで進める
    await vi.advanceTimersByTimeAsync(0)
    expect(sendDigestEmailMock).toHaveBeenCalledTimes(concurrency)

    // 間隔ぶん進めると、残りも送られる
    await vi.advanceTimersByTimeAsync(2000)
    expect(sendDigestEmailMock).toHaveBeenCalledTimes(USERS.length)

    const res = await promise
    const json = await res.json()
    expect(json.emailsSent).toBe(USERS.length)
  })

  it('「送った印」はかたまりが終わるたびに保存する（全部終わるまで待たない）', async () => {
    const promise = callPost()

    // 最初のかたまり（concurrency件）が終わった時点で、まだ間隔待ち中でも保存されている
    await vi.advanceTimersByTimeAsync(0)
    expect(prefsUpsertCalls).toHaveLength(1)
    expect(prefsUpsertCalls[0]).toHaveLength(concurrency)

    // 残りのかたまりが終わると、そのぶんも別に保存される
    await vi.advanceTimersByTimeAsync(2000)
    expect(prefsUpsertCalls).toHaveLength(2)
    expect(prefsUpsertCalls[1]).toHaveLength(USERS.length - concurrency)

    await promise
  })
})
