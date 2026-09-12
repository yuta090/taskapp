import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EMAIL_SEND_RATE_LIMIT } from '@/lib/email/sendRateLimit'

/**
 * POST /api/cron/notification-immediate も、notification-digest と同じく
 * Resend の送信回数の上限に合わせて一斉に送らず間隔を空ける。
 */

const CRON_SECRET = 'test-secret'
process.env.CRON_SECRET = CRON_SECRET

const { concurrency } = EMAIL_SEND_RATE_LIMIT
// concurrency件を最初のかたまりで使い切り、+1人ぶんを次のかたまりに残す
const USERS = Array.from({ length: concurrency + 1 }, (_, i) => `user-${i}`)
const WEEKDAY_NOON = new Date('2026-09-09T03:00:00.000Z') // 水 12:00 JST

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (resolve: (v: unknown) => void) => Promise.resolve(response).then(resolve)
  return builder
}

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
  }
}

const markSentCalls: unknown[][] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'notifications') {
        const builder = chain({
          data: USERS.map((u, i) => ({
            id: `n${i}`,
            to_user_id: u,
            type: 'review_request',
            payload: { title: 'レビュー依頼' },
            space_id: 'space-1',
            created_at: new Date().toISOString(),
          })),
          error: null,
        })
        builder.update = vi.fn(() => ({
          in: vi.fn((_col: string, ids: unknown[]) => {
            markSentCalls.push(ids)
            return Promise.resolve({ error: null })
          }),
        }))
        return builder
      }
      if (table === 'notification_email_prefs') return chain({ data: USERS.map(basePrefRow), error: null })
      if (table === 'spaces') return chain({ data: [{ id: 'space-1', name: 'PJ' }], error: null })
      if (table === 'profiles') return chain({ data: USERS.map((u) => ({ id: u, display_name: u })), error: null })
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

const { POST } = await import('@/app/api/cron/notification-immediate/route')

function callPost() {
  const request = new NextRequest(new URL('/api/cron/notification-immediate', 'http://localhost:3000'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return POST(request)
}

describe('POST /api/cron/notification-immediate — 送信は一斉に投げず間隔を空ける', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    markSentCalls.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(WEEKDAY_NOON)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it(`${USERS.length}人いても、最初はconcurrency(${concurrency})人ぶんだけ送り、残りは間隔を空けてから送る`, async () => {
    const promise = callPost()

    await vi.advanceTimersByTimeAsync(0)
    expect(sendDigestEmailMock).toHaveBeenCalledTimes(concurrency)

    await vi.advanceTimersByTimeAsync(2000)
    expect(sendDigestEmailMock).toHaveBeenCalledTimes(USERS.length)

    const res = await promise
    const json = await res.json()
    expect(json.emailsSent).toBe(USERS.length)
  })

  it('「送った印」はかたまりが終わるたびに保存する（全部終わるまで待たない）', async () => {
    const promise = callPost()

    await vi.advanceTimersByTimeAsync(0)
    expect(markSentCalls).toHaveLength(1)
    expect(markSentCalls[0]).toHaveLength(concurrency)

    await vi.advanceTimersByTimeAsync(2000)
    expect(markSentCalls).toHaveLength(2)
    expect(markSentCalls[1]).toHaveLength(USERS.length - concurrency)

    await promise
  })
})
