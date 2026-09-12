import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EMAIL_SEND_RATE_LIMIT } from '@/lib/email/sendRateLimit'

/**
 * POST /api/cron/client-reminders も、他のメール一斉送信cronと同じく
 * Resend の送信回数の上限に合わせて一斉に送らず間隔を空ける。
 */

const CRON_SECRET = 'test-secret'
process.env.CRON_SECRET = CRON_SECRET

const { concurrency } = EMAIL_SEND_RATE_LIMIT
// concurrency件を最初のかたまりで使い切り、+1人ぶんを次のかたまりに残す
const USERS = Array.from({ length: concurrency + 1 }, (_, i) => `user-${i}`)
const NOW = new Date('2026-09-09T03:00:00.000Z') // 水 12:00 JST

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

const TASKS = USERS.map((u, i) => ({
  id: `task-${i}`,
  title: `タスク${i}`,
  space_id: 'space-1',
  due_date: '2020-01-01', // 十分に過去＝overdue確定（スロットに関係なく送る）
  updated_at: NOW.toISOString(),
}))

const logUpsertCalls: unknown[][] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'tasks') return chain({ data: TASKS, error: null })
      if (table === 'spaces') return chain({ data: [{ id: 'space-1', name: 'PJ', org_id: null }], error: null })
      if (table === 'task_owners') {
        return chain({
          data: TASKS.map((t, i) => ({ task_id: t.id, user_id: USERS[i] })),
          error: null,
        })
      }
      if (table === 'task_events') return chain({ data: [], error: null })
      if (table === 'space_memberships') return chain({ data: [], error: null })
      if (table === 'profiles') {
        return chain({
          data: USERS.map((u) => ({ id: u, display_name: u, reminder_emails_enabled: true })),
          error: null,
        })
      }
      if (table === 'client_reminder_log') {
        const builder = chain({ data: [], error: null })
        builder.upsert = vi.fn((rows: unknown[]) => {
          logUpsertCalls.push(rows)
          return Promise.resolve({ error: null })
        })
        return builder
      }
      throw new Error(`Unexpected admin table: ${table}`)
    }),
    auth: {
      admin: {
        getUserById: vi.fn((id: string) => Promise.resolve({ data: { user: { email: `${id}@example.com` } } })),
      },
    },
  })),
}))

const sendReminderEmailMock = vi.fn((..._args: unknown[]) => Promise.resolve({ success: true }))
vi.mock('@/lib/email/reminder', () => ({
  sendReminderEmail: (...args: unknown[]) => sendReminderEmailMock(...args),
}))

const { POST } = await import('@/app/api/cron/client-reminders/route')

function callPost() {
  const request = new NextRequest(new URL('/api/cron/client-reminders', 'http://localhost:3000'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return POST(request)
}

describe('POST /api/cron/client-reminders — 送信は一斉に投げず間隔を空ける', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    logUpsertCalls.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it(`${USERS.length}人いても、最初はconcurrency(${concurrency})人ぶんだけ送り、残りは間隔を空けてから送る`, async () => {
    const promise = callPost()

    await vi.advanceTimersByTimeAsync(0)
    expect(sendReminderEmailMock).toHaveBeenCalledTimes(concurrency)

    await vi.advanceTimersByTimeAsync(2000)
    expect(sendReminderEmailMock).toHaveBeenCalledTimes(USERS.length)

    const res = await promise
    const json = await res.json()
    expect(json.emailsSent).toBe(USERS.length)
  })

  it('「送った印」はかたまりが終わるたびに保存する（全部終わるまで待たない）', async () => {
    const promise = callPost()

    await vi.advanceTimersByTimeAsync(0)
    expect(logUpsertCalls).toHaveLength(1)
    expect(logUpsertCalls[0]).toHaveLength(concurrency)

    await vi.advanceTimersByTimeAsync(2000)
    expect(logUpsertCalls).toHaveLength(2)
    expect(logUpsertCalls[1]).toHaveLength(USERS.length - concurrency)

    await promise
  })
})
