import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/notification-immediate
 *
 * 5分ごとに走り、「相手が待って止まっている」通知だけを1通にまとめて即時メールする。
 * - 夜21時〜朝8時・土日は送らない（翌朝のまとめで届く）
 * - 送ったものには印を付け、毎朝のまとめから外す（二重送信の防止）
 * - 印が付かないまま古くなった通知は、そのまま毎朝のまとめが拾う
 */

const CRON_SECRET = 'test-secret'
process.env.CRON_SECRET = CRON_SECRET

const USER_A = 'user-a'
const USER_B = 'user-b'

let notificationsResponse: { data: Array<Record<string, unknown>> | null; error: null | { message: string } }
let prefsResponse: { data: Array<Record<string, unknown>> | null; error: null }
let spacesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let profilesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let markedIds: unknown[][] = []
let markedValues: unknown[] = []
let notificationsQueryCalls: Record<string, unknown[][]> = {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any, calls?: Record<string, unknown[][]>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      if (calls) {
        calls[m] = calls[m] || []
        calls[m].push(args)
      }
      return builder
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (resolve: any, reject?: any) => Promise.resolve(response).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'notifications') {
        const builder = chain(notificationsResponse, notificationsQueryCalls)
        builder.update = vi.fn((values: unknown) => {
          markedValues.push(values)
          return {
            in: vi.fn((_col: string, ids: unknown[]) => {
              markedIds.push(ids)
              return Promise.resolve({ error: null })
            }),
          }
        })
        return builder
      }
      if (table === 'notification_email_prefs') return chain(prefsResponse)
      if (table === 'spaces') return chain(spacesResponse)
      if (table === 'profiles') return chain(profilesResponse)
      throw new Error(`Unexpected admin table: ${table}`)
    }),
    auth: {
      admin: {
        getUserById: vi.fn((id: string) =>
          Promise.resolve({ data: { user: { email: `${id}@example.com` } } })
        ),
      },
    },
  })),
}))

const sendDigestEmailMock = vi.fn((_params: Record<string, unknown>) =>
  Promise.resolve({ success: true, messageId: 'msg-1' })
)
vi.mock('@/lib/email/notificationDigest', () => ({
  sendNotificationDigestEmail: (params: Record<string, unknown>) => sendDigestEmailMock(params),
}))

const { POST, maxDuration } = await import('@/app/api/cron/notification-immediate/route')

function callPost(body: Record<string, unknown> = {}, auth = `Bearer ${CRON_SECRET}`) {
  const request = new NextRequest(new URL('/api/cron/notification-immediate', 'http://localhost:3000'), {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const WEEKDAY_NOON = new Date('2026-09-09T03:00:00.000Z') // 水 12:00 JST
const WEEKDAY_NIGHT = new Date('2026-09-09T14:00:00.000Z') // 水 23:00 JST
const SATURDAY_NOON = new Date('2026-09-12T03:00:00.000Z') // 土 12:00 JST

function notif(id: string, userId: string, type: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    to_user_id: userId,
    type,
    payload: { title: `${type} の件` },
    space_id: 'space-1',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function basePrefRow(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    email_enabled: true,
    on_task_assigned: true,
    on_task_mentioned: true,
    on_review_request: true,
    on_client_response: true,
    on_meeting_reminder: true,
    digest_frequency: 'daily',
    ...overrides,
  }
}

describe('POST /api/cron/notification-immediate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(WEEKDAY_NOON)
    markedIds = []
    markedValues = []
    notificationsQueryCalls = {}

    notificationsResponse = {
      data: [notif('n1', USER_A, 'review_request'), notif('n2', USER_A, 'confirmation_request')],
      error: null,
    }
    prefsResponse = { data: [basePrefRow(USER_A)], error: null }
    spacesResponse = { data: [{ id: 'space-1', name: 'PJ-A' }], error: null }
    profilesResponse = { data: [{ id: USER_A, display_name: 'ユーザーA' }], error: null }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('シークレットが違えば401', async () => {
    const res = await callPost({}, 'Bearer wrong')
    expect(res.status).toBe(401)
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
  })

  it('待たせている通知を1通にまとめて送る', async () => {
    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.emailsSent).toBe(1)
    expect(sendDigestEmailMock).toHaveBeenCalledTimes(1)
    expect(sendDigestEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: `${USER_A}@example.com`,
        variant: 'immediate',
        totalCount: 2,
      })
    )
  })

  it('人ごとに1通ずつに分かれる', async () => {
    notificationsResponse = {
      data: [notif('n1', USER_A, 'review_request'), notif('n2', USER_B, 'ball_passed')],
      error: null,
    }
    prefsResponse = { data: [basePrefRow(USER_A), basePrefRow(USER_B)], error: null }

    const json = await (await callPost()).json()

    expect(json.emailsSent).toBe(2)
    expect(sendDigestEmailMock).toHaveBeenCalledTimes(2)
  })

  it('送った通知に印を付ける(翌朝のまとめと二重にならないように)', async () => {
    await callPost()

    expect(markedIds).toEqual([['n1', 'n2']])
    expect(markedValues[0]).toEqual({ immediate_email_sent_at: expect.any(String) })
  })

  it('夜間は送らない(翌朝のまとめに任せる)', async () => {
    vi.setSystemTime(WEEKDAY_NIGHT)

    const json = await (await callPost()).json()

    expect(json).toMatchObject({ emailsSent: 0, skipped: 'quiet_hours' })
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
    expect(markedIds).toEqual([])
  })

  it('土日は送らない', async () => {
    vi.setSystemTime(SATURDAY_NOON)

    const json = await (await callPost()).json()

    expect(json).toMatchObject({ emailsSent: 0, skipped: 'quiet_hours' })
  })

  it('最近のぶんだけを対象にする(夜間にたまった古いものを朝まとめて送らない)', async () => {
    await callPost()

    const gteCalls = notificationsQueryCalls.gte || []
    expect(gteCalls).toHaveLength(1)
    const [, cutoff] = gteCalls[0] as [string, string]
    const ageMinutes = (WEEKDAY_NOON.getTime() - new Date(cutoff).getTime()) / 60000
    expect(ageMinutes).toBeGreaterThan(0)
    expect(ageMinutes).toBeLessThanOrEqual(20)
  })

  it('まだ送っていないものだけを対象にする', async () => {
    await callPost()

    expect(notificationsQueryCalls.is).toEqual([['immediate_email_sent_at', null]])
  })

  it('メールを止めている人には送らない', async () => {
    prefsResponse = { data: [basePrefRow(USER_A, { email_enabled: false })], error: null }

    const json = await (await callPost()).json()

    expect(json.emailsSent).toBe(0)
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
    expect(markedIds).toEqual([])
  })

  it('頻度を「オフ」にした人にも送らない', async () => {
    prefsResponse = { data: [basePrefRow(USER_A, { digest_frequency: 'none' })], error: null }

    const json = await (await callPost()).json()

    expect(json.emailsSent).toBe(0)
  })

  it('種類ごとの受信をオフにしている人には、その種類を送らない', async () => {
    prefsResponse = { data: [basePrefRow(USER_A, { on_review_request: false })], error: null }

    const json = await (await callPost()).json()

    // review_request と confirmation_request は同じ見出し(承認・レビュー)なので両方止まる
    expect(json.emailsSent).toBe(0)
    expect(markedIds).toEqual([])
  })

  it('設定を保存したことがない人にも送る(既定はオン)', async () => {
    prefsResponse = { data: [], error: null }

    const json = await (await callPost()).json()

    expect(json.emailsSent).toBe(1)
  })

  it('対象が無ければ何もしない', async () => {
    notificationsResponse = { data: [], error: null }

    const json = await (await callPost()).json()

    expect(json).toMatchObject({ candidateCount: 0, emailsSent: 0 })
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
  })

  it('dryRun では送らず、送る予定だけ返す', async () => {
    const json = await (await callPost({ dryRun: true })).json()

    expect(json.dryRun).toBe(true)
    expect(json.plan).toEqual([{ userId: USER_A, totalCount: 2 }])
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
    expect(markedIds).toEqual([])
  })
})

describe('実行時間の上限', () => {
  it('既定より長い間隔を空けた送信でも打ち切られないよう300秒にしている', () => {
    expect(maxDuration).toBe(300)
  })
})
