import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/notification-digest
 *
 * - Bearer CRON_SECRET 必須
 * - notification_email_prefs で受信ONのユーザーごとに in_app 通知を集約し1通のダイジェストを送る
 * - 追加: 各受信者が作った未承諾の招待（作成から3〜21日・未失効）をまとめの末尾に足す
 *   （この節だけでは送らない＝通常のdigestが0件のときは送信しない、という既存判定は変えない）
 *   境界（Fable裁定）:
 *     (a) 招待作成者が今もそのorgのメンバーであること（org_memberships）
 *     (b) 作成から3〜21日の招待のみ（それ以降は催促しない）
 *     (c) 招待先メールが既にそのorgのメンバーのメールと一致する行は除外（誤催促防止）
 *     (d) invitesクエリは created_at 昇順・上限200件、上限到達時はconsole.warn
 */

const CRON_SECRET = 'test-secret'
process.env.CRON_SECRET = CRON_SECRET

const ORG_ID = 'org-1'

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

/** chain() の各メソッド呼び出し引数を記録できるようにラップする */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recordingChain(response: any, calls: Record<string, unknown[][]>) {
  const builder = chain(response)
  for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'gt', 'lte', 'is', 'order', 'limit']) {
    const original = builder[m]
    builder[m] = vi.fn((...args: unknown[]) => {
      calls[m] = calls[m] || []
      calls[m].push(args)
      return original(...args)
    })
  }
  return builder
}

let prefsResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let notificationsResponse: { data: Array<Record<string, unknown>> | null; error: null }
let spacesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let profilesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let invitesResponse: { data: Array<Record<string, unknown>> | null; error: null }
let orgMembershipsResponse: { data: Array<Record<string, unknown>> | null; error: null }
let prefsUpdateResponse: { data: null; error: null }
let getUserByIdImpl: (id: string) => Promise<{ data: { user: { email: string } | null } }>

let invitesFromCallCount = 0
let orgMembershipsFromCallCount = 0
let profilesFromCallCount = 0
let invitesQueryCalls: Record<string, unknown[][]> = {}
let notificationsQueryCalls: Record<string, unknown[][]> = {}
let prefsUpsertRows: unknown[] = []
let getUserByIdCalls: string[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'notification_email_prefs') {
        const builder = chain(prefsResponse)
        builder.update = vi.fn(() => chain(prefsUpdateResponse))
        builder.upsert = vi.fn((rows: unknown) => {
          prefsUpsertRows.push(rows)
          return chain(prefsUpdateResponse)
        })
        return builder
      }
      if (table === 'notifications') return recordingChain(notificationsResponse, notificationsQueryCalls)
      if (table === 'spaces') return chain(spacesResponse)
      if (table === 'profiles') {
        // profilesにemail列は無いため、受信者のdisplay_name解決だけがここを通る。
        // (c)の既存メンバーのメール解決は auth.admin.getUserById（下の mock）で行う。
        profilesFromCallCount += 1
        return chain(profilesResponse)
      }
      if (table === 'org_memberships') {
        orgMembershipsFromCallCount += 1
        return chain(orgMembershipsResponse)
      }
      if (table === 'invites') {
        invitesFromCallCount += 1
        return recordingChain(invitesResponse, invitesQueryCalls)
      }
      throw new Error(`Unexpected admin table: ${table}`)
    }),
    auth: {
      admin: {
        getUserById: vi.fn((id: string) => {
          getUserByIdCalls.push(id)
          return getUserByIdImpl(id)
        }),
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

function resetHarness() {
  vi.clearAllMocks()
  invitesFromCallCount = 0
  orgMembershipsFromCallCount = 0
  profilesFromCallCount = 0
  invitesQueryCalls = {}
  notificationsQueryCalls = {}
  prefsUpsertRows = []
  getUserByIdCalls = []

  prefsResponse = { data: [basePrefRow(USER_A)], error: null }
    notificationsResponse = {
      data: [
        { to_user_id: USER_A, type: 'task_assigned', payload: { title: 'タスクA' }, space_id: 'space-1', created_at: new Date().toISOString() },
      ],
      error: null,
    }
    spacesResponse = { data: [{ id: 'space-1', name: 'PJ-A' }], error: null }
    profilesResponse = { data: [{ id: USER_A, display_name: 'ユーザーA' }], error: null }
    // 既定: 招待作成者(USER_A)は今もorg-1のメンバー。メールは招待先と重複しない。
    orgMembershipsResponse = { data: [{ org_id: ORG_ID, user_id: USER_A }], error: null }
    invitesResponse = { data: [], error: null }
  prefsUpdateResponse = { data: null, error: null }
  // profilesにemail列は無いため、既存メンバーのメールは管理用の鍵(auth.admin.getUserById)で解決する
  getUserByIdImpl = (id: string) => Promise.resolve({ data: { user: { email: `${id}@example.com` } } })
}

describe('POST /api/cron/notification-digest — 未承諾の招待の節', () => {
  beforeEach(resetHarness)

  it('未承諾の招待が2件あれば、digestのpendingInvitesとしてメール送信関数に渡す', async () => {
    invitesResponse = {
      data: [
        { created_by: USER_A, org_id: ORG_ID, email: 'invitee1@example.com', space_id: 'space-2', created_at: '2026-08-01T00:00:00.000Z' },
        { created_by: USER_A, org_id: ORG_ID, email: 'invitee2@example.com', space_id: 'space-2', created_at: '2026-08-02T00:00:00.000Z' },
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
      data: [{ created_by: USER_A, org_id: ORG_ID, email: 'invitee1@example.com', space_id: 'space-1', created_at: '2026-08-01T00:00:00.000Z' }],
      error: null,
    }

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
  })

  it('受信者が複数いても invites/org_memberships/profiles への問い合わせは1回にまとめる（N+1回避）', async () => {
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
    invitesResponse = {
      data: [
        { created_by: USER_A, org_id: ORG_ID, email: 'invitee1@example.com', space_id: 'space-1', created_at: '2026-08-01T00:00:00.000Z' },
        { created_by: USER_B, org_id: ORG_ID, email: 'invitee2@example.com', space_id: 'space-1', created_at: '2026-08-01T00:00:00.000Z' },
      ],
      error: null,
    }
    orgMembershipsResponse = {
      data: [
        { org_id: ORG_ID, user_id: USER_A },
        { org_id: ORG_ID, user_id: USER_B },
      ],
      error: null,
    }

    await callPost()

    expect(invitesFromCallCount).toBe(1)
    expect(orgMembershipsFromCallCount).toBe(1)
    // profiles への問い合わせは受信者のdisplay_name解決の1回だけ（ユーザー数(N)には比例しない）。
    // profilesにemail列は無いため、既存メンバーのメール解決はauth.admin.getUserByIdで
    // メンバーごとに1回ずつ行う（受信者本人のメール送信解決とは別枠。対象はorgメンバー数分で、
    // 通知件数には比例しない）
    expect(profilesFromCallCount).toBe(1)
    expect(new Set(getUserByIdCalls)).toEqual(new Set([USER_A, USER_B]))
    expect(invitesQueryCalls.in?.[0]?.[1]).toEqual(expect.arrayContaining([USER_A, USER_B]))
  })

  it('招待作成者が今はorgのメンバーでなければ載せない', async () => {
    invitesResponse = {
      data: [{ created_by: USER_A, org_id: ORG_ID, email: 'invitee1@example.com', space_id: 'space-1', created_at: '2026-08-01T00:00:00.000Z' }],
      error: null,
    }
    // USER_A は退会済み(org_memberships に行が無い)
    orgMembershipsResponse = { data: [], error: null }

    await callPost()

    const params = sendDigestEmailMock.mock.calls[0][0] as { pendingInvites?: unknown }
    expect(params.pendingInvites).toBeUndefined()
  })

  it('招待先メールが既にそのorgのメンバーのメールと一致する行は除外する', async () => {
    invitesResponse = {
      data: [
        { created_by: USER_A, org_id: ORG_ID, email: 'already-joined@example.com', space_id: 'space-1', created_at: '2026-08-01T00:00:00.000Z' },
        { created_by: USER_A, org_id: ORG_ID, email: 'still-pending@example.com', space_id: 'space-1', created_at: '2026-08-02T00:00:00.000Z' },
      ],
      error: null,
    }
    // 既にメンバーになっている人がいて、そのメールが招待先の1件目と一致する
    orgMembershipsResponse = {
      data: [
        { org_id: ORG_ID, user_id: USER_A },
        { org_id: ORG_ID, user_id: 'already-joined-user' },
      ],
      error: null,
    }
    const emailByUserId: Record<string, string> = {
      [USER_A]: 'usera@example.com',
      'already-joined-user': 'already-joined@example.com',
    }
    getUserByIdImpl = (id: string) => Promise.resolve({ data: { user: { email: emailByUserId[id] ?? null } } })

    await callPost()

    const params = sendDigestEmailMock.mock.calls[0][0] as { pendingInvites?: { count: number; items: Array<Record<string, unknown>> } }
    expect(params.pendingInvites?.count).toBe(1)
    expect(params.pendingInvites?.items[0]).toMatchObject({ email: 'still-pending@example.com' })
  })

  it('invitesクエリは created_at 昇順・上限200件を指定する', async () => {
    await callPost()

    expect(invitesQueryCalls.order?.[0]).toEqual(['created_at', { ascending: true }])
    expect(invitesQueryCalls.limit?.[0]).toEqual([200])
  })

  it('invitesクエリの期間は作成から3〜21日に限定する(下限・上限の両方を指定)', async () => {
    await callPost()

    expect(invitesQueryCalls.lte?.[0]?.[0]).toBe('created_at')
    expect(invitesQueryCalls.gte).toBeDefined()
    // gte は notifications 側(通知window)とは別に invites 独自でも呼ばれる(21日下限)
    const inviteGte = invitesQueryCalls.gte?.find((args) => args[0] === 'created_at')
    expect(inviteGte).toBeDefined()
  })

  it('招待が200件（上限）に達したら console.warn で知らせる', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    invitesResponse = {
      data: Array.from({ length: 200 }, (_, i) => ({
        created_by: USER_A,
        org_id: ORG_ID,
        email: `invitee${i}@example.com`,
        space_id: 'space-1',
        created_at: '2026-08-01T00:00:00.000Z',
      })),
      error: null,
    }

    await callPost()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 設定画面は「メール通知オン・毎日」と表示するが、スイッチを一度も触っていない人には
 * notification_email_prefs の行が無い。行がある人だけを対象にしていたため、
 * 実際には誰にも届いていなかった（本番で行数0件）。既定=オンとして扱う。
 */
describe('POST /api/cron/notification-digest — 設定を触っていない人', () => {
  beforeEach(() => {
    resetHarness()
    prefsResponse = { data: [], error: null } // 誰も設定を保存していない
  })

  it('設定行が無くても、通知があればまとめが届く', async () => {
    const res = await callPost()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.emailsSent).toBe(1)
    expect(sendDigestEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: `${USER_A}@example.com` }),
    )
  })

  it('送ったあとに設定行を作る(次回は前回送信以降だけが対象になる)', async () => {
    await callPost()

    expect(prefsUpsertRows).toHaveLength(1)
    expect(prefsUpsertRows[0]).toEqual([
      expect.objectContaining({ user_id: USER_A, last_digest_sent_at: expect.any(String) }),
    ])
  })

  it('自分でオフにした人には届かない', async () => {
    prefsResponse = { data: [basePrefRow(USER_A, { email_enabled: false })], error: null }

    const res = await callPost()
    const json = await res.json()

    expect(json.emailsSent).toBe(0)
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
  })

  it('頻度を「オフ」にした人には届かない', async () => {
    prefsResponse = { data: [basePrefRow(USER_A, { digest_frequency: 'none' })], error: null }

    const res = await callPost()
    const json = await res.json()

    expect(json.emailsSent).toBe(0)
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
  })

  it('通知が1件も無い人は候補にならない(空メールを送らない)', async () => {
    notificationsResponse = { data: [], error: null }

    const res = await callPost()
    const json = await res.json()

    expect(json.candidateCount).toBe(0)
    expect(sendDigestEmailMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/cron/notification-digest — 即時メールとの二重送信', () => {
  beforeEach(resetHarness)

  it('即時メールで送り済みの通知はまとめに入れない', async () => {
    await callPost()

    expect(notificationsQueryCalls.is).toEqual([['immediate_email_sent_at', null]])
  })
})
