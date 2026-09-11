import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 協力会社（role='vendor'）によるタスクのステータス変更は、本人のセッションで
 * 直接 tasks を書くのではなく、このサーバー側 API（service role）が
 * ・本人のセッションで対象タスクが読めるか、今のステータスが変更可能な4状態か
 * ・そのタスクの space で role='vendor' か、その space が代理店モードか
 * を確かめたうえで、確認済みの条件を固定して書き込む。
 *
 * next/server の after() のモックは、キューに積むだけで即実行しない
 * （応答時点ではまだ実行されていないことを確認するため）。
 */
const afterTasks: Array<() => unknown> = []
const mockAfter = vi.fn((task: () => unknown) => {
  afterTasks.push(task)
})
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (task: () => unknown) => mockAfter(task) }
})
async function runAfterTasks() {
  const tasks = afterTasks.splice(0, afterTasks.length)
  for (const task of tasks) await task()
}

/** Builds a minimal (unsigned) JWT carrying only the claims checkAal2 reads. */
function jwt(payload: Record<string, unknown>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`
}

const mockUser = { id: 'vendor-user-1' }
const TASK_ID = '11111111-1111-4111-8111-111111111111'

const baseTask = {
  id: TASK_ID,
  space_id: 'space-1',
  org_id: 'org-1',
  status: 'todo',
}

const baseMembership = {
  id: 'membership-1',
  role: 'vendor',
  space_id: 'space-1',
  user_id: mockUser.id,
  spaces: { agency_mode: true },
}

let authResponse: { data: { user: (typeof mockUser & { factors?: Array<{ status: string }> }) | null } }
let sessionAccessToken: string | null = null
let taskResponse: { data: typeof baseTask | null; error: null | { message: string } }
let membershipRow: typeof baseMembership | null
let updateTaskResponse: { data: { id: string } | null; error: null | { message: string } }

interface AdminFilterCall {
  type: 'eq' | 'in'
  col: string
  val: unknown
}
interface AdminUpdateCall {
  payload: Record<string, unknown>
  filterCalls: AdminFilterCall[]
}

const adminUpdateCalls: AdminUpdateCall[] = []
const taskSelectEqCalls: Array<[string, unknown]> = []
const membershipEqCalls: Array<[string, unknown]> = []
const membershipSelectArgs: string[] = []
const createAuditLogMock = vi.fn((..._args: unknown[]) => Promise.resolve({ success: true }))

vi.mock('@/lib/audit', () => ({
  createAuditLog: (...args: unknown[]) => createAuditLogMock(...args),
  generateAuditSummary: vi.fn(() => 'ステータスを変更しました'),
}))

/** Records each `.eq()`/`.in()` condition on a tasks UPDATE, plus the payload. */
function makeTasksUpdateBuilder(payload: Record<string, unknown>) {
  const filterCalls: AdminFilterCall[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  builder.eq = vi.fn((col: string, val: unknown) => {
    filterCalls.push({ type: 'eq', col, val })
    return builder
  })
  builder.in = vi.fn((col: string, val: unknown) => {
    filterCalls.push({ type: 'in', col, val })
    return builder
  })
  builder.select = vi.fn(() => ({
    maybeSingle: vi.fn(() => Promise.resolve(updateTaskResponse)),
  }))
  adminUpdateCalls.push({ payload, filterCalls })
  return builder
}

// Session client: used only to confirm who is acting and what they may act on
// (reading the task, checking vendor membership & agency_mode) — never for writing.
// The space_memberships query actually filters by the recorded `.eq()` conditions
// against `membershipRow`, so a fixture with a non-vendor role is genuinely
// excluded by the `role='vendor'` condition instead of being hard-coded to null.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
        getSession: vi.fn(() =>
          Promise.resolve({
            data: { session: sessionAccessToken ? { access_token: sessionAccessToken } : null },
          })
        ),
      },
      from: vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: unknown) => {
                taskSelectEqCalls.push([col, val])
                return { single: vi.fn(() => Promise.resolve(taskResponse)) }
              }),
            })),
          }
        }
        if (table === 'space_memberships') {
          return {
            select: vi.fn((selectArg: string) => {
              membershipSelectArgs.push(selectArg)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const builder: any = {}
              builder.eq = vi.fn((col: string, val: unknown) => {
                membershipEqCalls.push([col, val])
                return builder
              })
              builder.single = vi.fn(() => {
                if (!membershipRow) return Promise.resolve({ data: null, error: null })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const matches = membershipEqCalls.every(([col, val]) => (membershipRow as any)[col] === val)
                return Promise.resolve({ data: matches ? membershipRow : null, error: null })
              })
              return builder
            }),
          }
        }
        throw new Error(`Unexpected table on session client: ${table}`)
      }),
    })
  ),
}))

// Server-side (service role) client: performs the actual write, only once
// confirmation on the session client has passed.
const createAdminClientMock = vi.fn(() => ({
  from: vi.fn((table: string) => {
    if (table === 'tasks') {
      return {
        update: vi.fn((payload: Record<string, unknown>) => makeTasksUpdateBuilder(payload)),
      }
    }
    throw new Error(`Unexpected table on admin client: ${table}`)
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const { POST } = await import('@/app/api/vendor-portal/tasks/[taskId]/status/route')

function callPost(taskId: string, body: Record<string, unknown> | string) {
  const request = new NextRequest(new URL(`/api/vendor-portal/tasks/${taskId}/status`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ taskId }) })
}

describe('POST /api/vendor-portal/tasks/[taskId]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminUpdateCalls.length = 0
    taskSelectEqCalls.length = 0
    membershipEqCalls.length = 0
    membershipSelectArgs.length = 0
    afterTasks.length = 0

    authResponse = { data: { user: mockUser } }
    sessionAccessToken = null
    taskResponse = { data: { ...baseTask }, error: null }
    membershipRow = { ...baseMembership }
    updateTaskResponse = { data: { id: TASK_ID }, error: null }
  })

  it('未ログインなら401で、admin クライアントは作られない', async () => {
    authResponse = { data: { user: null } }

    const response = await callPost(TASK_ID, { status: 'in_progress' })

    expect(response.status).toBe(401)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('二要素認証が登録済み×コード未入力(aal1)なら403で止め、admin クライアントは作られない', async () => {
    authResponse = { data: { user: { ...mockUser, factors: [{ status: 'verified' }] } } }
    sessionAccessToken = jwt({ aal: 'aal1' })

    const response = await callPost(TASK_ID, { status: 'in_progress' })

    expect(response.status).toBe(403)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('taskId がUUID形式でなければ400で、admin クライアントは作られない', async () => {
    const response = await callPost('not-a-uuid', { status: 'in_progress' })

    expect(response.status).toBe(400)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('本文が壊れたJSONなら400で、admin クライアントは作られない', async () => {
    const response = await callPost(TASK_ID, '{not-json')

    expect(response.status).toBe(400)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it.each(['done', 'considering', 'archived'])(
    '許可されていないステータス(%s)なら400で、admin クライアントは作られない',
    async (status) => {
      const response = await callPost(TASK_ID, { status })

      expect(response.status).toBe(400)
      expect(createAdminClientMock).not.toHaveBeenCalled()
    }
  )

  it('本人のセッションでタスクが読めなければ404で、admin クライアントは作られない', async () => {
    taskResponse = { data: null, error: { message: 'not found' } }

    const response = await callPost(TASK_ID, { status: 'in_progress' })

    expect(response.status).toBe(404)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('タスクの読み取りは id を条件にする', async () => {
    await callPost(TASK_ID, { status: 'in_progress' })
    expect(taskSelectEqCalls).toContainEqual(['id', TASK_ID])
  })

  it.each(['done', 'considering'])(
    '読み取った時点のステータスが%sなら409（変更できる4状態のどれでもない）で、admin クライアントは作られない',
    async (status) => {
      taskResponse = { data: { ...baseTask, status }, error: null }

      const response = await callPost(TASK_ID, { status: 'in_progress' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error).toBe('このタスクは完了済み、または検討中のため変更できません')
      expect(createAdminClientMock).not.toHaveBeenCalled()
    }
  )

  it.each(['client', 'editor', 'admin', 'viewer'])(
    'space の role が %s（vendorでない）なら403で、admin クライアントは作られない',
    async (role) => {
      membershipRow = { ...baseMembership, role }

      const response = await callPost(TASK_ID, { status: 'in_progress' })

      expect(response.status).toBe(403)
      expect(createAdminClientMock).not.toHaveBeenCalled()
    }
  )

  it('membership 自体が無ければ403で、admin クライアントは作られない', async () => {
    membershipRow = null

    const response = await callPost(TASK_ID, { status: 'in_progress' })

    expect(response.status).toBe(403)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('space が代理店モードでなければ403で、admin クライアントは作られない', async () => {
    membershipRow = { ...baseMembership, spaces: { agency_mode: false } }

    const response = await callPost(TASK_ID, { status: 'in_progress' })

    expect(response.status).toBe(403)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('space_memberships の読み取りは space_id・user_id・role=vendor を条件にする', async () => {
    await callPost(TASK_ID, { status: 'in_progress' })

    expect(membershipEqCalls).toContainEqual(['space_id', baseTask.space_id])
    expect(membershipEqCalls).toContainEqual(['user_id', mockUser.id])
    expect(membershipEqCalls).toContainEqual(['role', 'vendor'])
    // agency_mode の確認に使う space の列も一緒に読んでいること
    expect(membershipSelectArgs[0]).toContain('agency_mode')
  })

  it.each(['client', 'viewer'])(
    '役割の確認が先: role=%s が完了済みタスクを変えようとしても、状態の409ではなく403になる',
    async (role) => {
      taskResponse = { data: { ...baseTask, status: 'done' }, error: null }
      membershipRow = { ...baseMembership, role }

      const response = await callPost(TASK_ID, { status: 'in_progress' })

      expect(response.status).toBe(403)
      expect(createAdminClientMock).not.toHaveBeenCalled()
    }
  )

  it('更新対象の行が無ければ409（読み取り後に他の誰かが先に操作した扱い）', async () => {
    updateTaskResponse = { data: null, error: null }

    const response = await callPost(TASK_ID, { status: 'in_progress' })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('タスクの状態が変更されました。ページを再読み込みしてください。')
  })

  it('DBのエラーは500', async () => {
    updateTaskResponse = { data: null, error: { message: 'connection error' } }

    const response = await callPost(TASK_ID, { status: 'in_progress' })

    expect(response.status).toBe(500)
  })

  it('確認済みの id・space_id・変更可能な4状態のみを固定条件にして、status と updated_at だけを書き込む', async () => {
    const response = await callPost(TASK_ID, { status: 'in_progress' })

    expect(response.status).toBe(200)
    expect(adminUpdateCalls).toHaveLength(1)
    expect(Object.keys(adminUpdateCalls[0].payload).sort()).toEqual(['status', 'updated_at'])
    expect(adminUpdateCalls[0].payload.status).toBe('in_progress')

    expect(adminUpdateCalls[0].filterCalls).toContainEqual({ type: 'eq', col: 'id', val: TASK_ID })
    expect(adminUpdateCalls[0].filterCalls).toContainEqual({ type: 'eq', col: 'space_id', val: 'space-1' })
    const inCall = adminUpdateCalls[0].filterCalls.find((c) => c.type === 'in' && c.col === 'status')
    expect(inCall?.val).toEqual(['backlog', 'todo', 'in_progress', 'in_review'])
  })

  it('成功時のみ成功メッセージを返す', async () => {
    const response = await callPost(TASK_ID, { status: 'in_progress' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.message).toBe('ステータスを更新しました')
  })

  it('監査ログは after() 経由で記録される（応答時点ではまだ実行されない）', async () => {
    const response = await callPost(TASK_ID, { status: 'in_progress' })
    expect(response.status).toBe(200)

    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(createAuditLogMock).not.toHaveBeenCalled()

    await runAfterTasks()

    expect(createAuditLogMock).toHaveBeenCalledTimes(1)
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        actorId: mockUser.id,
        actorRole: 'vendor',
        eventType: 'task.status_changed',
        targetId: TASK_ID,
      })
    )
  })
})
