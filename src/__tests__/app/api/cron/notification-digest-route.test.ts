import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/notification-digest
 *
 * - Bearer CRON_SECRET 必須
 * - notification_email_prefs で受信ONのユーザーごとに in_app 通知を集約し1通のダイジェストを送る
 * - 追加: 各受信者が作った未承諾の招待（作成から3日以上・未失効）をまとめの末尾に足す
 *   （この節だけでは送らない＝通常のdigestが0件のときは送信しない、という既存判定は変えない）
 */

const CRON_SECRET = 'test-secret'
process.env.CRON_SECRET = CRON_SECRET

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

let prefsResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let notificationsResponse: { data: Array<Record<string, unknown>> | null; error: null }
let spacesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let profilesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let invitesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let prefsUpdateResponse: { data: null; error: null }
let getUserByIdImpl: (id: string) => Promise<{ data: { user: { email: string } | null } }>

let invitesFromCallCount = 0
let invitesQueryArgs: { in?: unknown[]; is?: unknown[]; gt?: unknown[]; lte?: unknown[] } = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'notification_email_prefs') {
        const builder = chain(prefsResponse)
        builder.update = vi.fn(() => chain(prefsUpdateResponse))
        return builder
      }
      if (table === 'notifications') return chain(notificationsResponse)
      if (table === 'spaces') return chain(spacesResponse)
      if (table === 'profiles') return chain(profilesResponse)
      if (table === 'invites') {
        invitesFromCallCount += 1
        const builder = chain(invitesResponse)
        const origIn = builder.in
        const origIs = builder.is
        const origGt = builder.gt
        const origLte = builder.lte
        builder.in = vi.fn((...args: unknown[]) => {
          invitesQueryArgs.in = args
          return origIn(...args)
        })
        builder.is = vi.fn((...args: unknown[]) => {
          invitesQueryArgs.is = args
          return origIs(...args)
        })
        builder.gt = vi.fn((...args: unknown[]) => {
          invitesQueryArgs.gt = args
          return origGt(...args)
        })
        builder.lte = vi.fn((...args: unknown[]) => {
          invitesQueryArgs.lte = args
          return origLte(...args)
        })
        return builder
      }
      throw new Error(`Unexpected admin table: ${table}`)
    }),
    auth: {
      admin: {
        getUserById: vi.fn((id: string) => getUserByIdImpl(id)),
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

function callPost(body: Record<string, unknown> = {}) {
  const request = new NextRequest(new URL('/api/cron/notification-digest', 'http://localhost:3000'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const USER_A = 'user-a'
const USER_B = 'user-b'

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
    last_digest_sent_at: null,
    ...overrides,
  }
}

describe('POST /api/cron/notification-digest — 未承諾の招待の節', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invitesFromCallCount = 0
    invitesQueryArgs = {}

    prefsResponse = { data: [basePrefRow(USER_A)], error: null }
    notificationsResponse = {
      data: [
        { to_user_id: USER_A, type: 'task_assigned', payload: { title: 'タスクA' }, space_id: 'space-1', created_at: new Date().toISOString() },
      ],
      error: null,
    }
    spacesResponse = { data: [{ id: 'space-1', name: 'PJ-A' }], error: null }
    profilesResponse = { data: [{ id: USER_A, display_name: 'ユーザーA' }], error: null }
    invitesResponse = { data: [], error: null }
    prefsUpdateResponse = { data: null, error: null }
    getUserByIdImpl = (id: string) => Promise.resolve({ data: { user: { email: `${id}@example.com` } } })
  })

  it('未承諾の招待が2件あれば、digestのpendingInvitesとしてメール送信関数に渡す', async () => {
    invitesResponse = {
      data: [
        { created_by: USER_A, email: 'invitee1@example.com', space_id: 'space-2', created_at: '2026-08-01T00:00:00.000Z' },
        { created_by: USER_A, email: 'invitee2@example.com', space_id: 'space-2', created_at: '2026-08-02T00:00:00.000Z' },
      ],
      error: null,
    }
    spacesResponse = {
      data: [
        { id: 'space-1', name: 'PJ-A' },
        { id: 'space-2', name: 'PJ-B' },
      ],
      error: null,
    }

    const response = await callPost()
    expect(response.status).toBe(200)

    expect(sendDigestEmailMock).toHaveBeenCalledTimes(1)
    const params = sendDigestEmailMock.mock.calls[0][0] as { pendingInvites?: { count: number; items: Array<Record<string, unknown>> } }
    expect(params.pendingInvites).toBeDefined()
    expect(params.pendingInvites?.count).toBe(2)
    expect(params.pendingInvites?.items).toHaveLength(2)
    expect(params.pendingInvites?.items[0]).toMatchObject({ email: 'invitee1@example.com', spaceName: 'PJ-B' })
  })

  it('未承諾の招待が0件なら pendingInvites を付けない', async () => {
    invitesResponse = { data: [], error: null }

    await callPost()

    const params = sendDigestEmailMock.mock.calls[0][0] as { pendingInvites?: unknown }
    expect(params.pendingInvites).toBeUndefined()
  })

  it('通常の通知が0件（digestがnull）なら、未承諾の招待があってもメールを送らない', async () => {
    notificationsResponse = { data: [], error: null }
    invitesResponse = {
      data: [{ created_by: USER_A, email: 'invitee1@example.com', space_id: 'space-1', created_at: '2026-08-01T00:00:00.000Z' }],
      error: null,
    }

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
  })

  it('受信者が複数いても invites への問い合わせは1回にまとめる（N+1回避）', async () => {
    prefsResponse = { data: [basePrefRow(USER_A), basePrefRow(USER_B)], error: null }
    notificationsResponse = {
      data: [
        { to_user_id: USER_A, type: 'task_assigned', payload: { title: 'タスクA' }, space_id: 'space-1', created_at: new Date().toISOString() },
        { to_user_id: USER_B, type: 'task_assigned', payload: { title: 'タスクB' }, space_id: 'space-1', created_at: new Date().toISOString() },
      ],
      error: null,
    }
    profilesResponse = {
      data: [
        { id: USER_A, display_name: 'ユーザーA' },
        { id: USER_B, display_name: 'ユーザーB' },
      ],
      error: null,
    }

    await callPost()

    expect(invitesFromCallCount).toBe(1)
    expect(invitesQueryArgs.in?.[1]).toEqual(expect.arrayContaining([USER_A, USER_B]))
  })
})
