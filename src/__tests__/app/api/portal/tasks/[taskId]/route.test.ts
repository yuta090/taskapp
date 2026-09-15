import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Regression tests for the audit-log/Slack-notify fire-and-forget fix:
 * an un-awaited write can be cut off once the response is sent (observed in
 * production: audit_logs stayed empty for portal requests). Both side effects
 * must be handed to next/server's after() so they run to completion even
 * after the response goes out.
 *
 * The mock only queues the callback (it does NOT run it immediately) so tests
 * can assert that side effects have not run yet at response time, and only
 * happen once the queued after() tasks are actually drained — a mock that
 * auto-invokes would pass even if the code called createAuditLog directly
 * instead of through after().
 */
const afterTasks: Array<() => unknown> = []
const mockAfter = vi.fn((task: () => unknown) => {
  afterTasks.push(task)
})
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (task: () => unknown) => mockAfter(task) }
})
/** Runs and clears every after() task queued so far, in the order they were registered. */
async function runAfterTasks() {
  const tasks = afterTasks.splice(0, afterTasks.length)
  for (const task of tasks) await task()
}

/**
 * Regression tests for H-1 (UX audit 2026-07-05):
 * - Approve/request_changes only fired a fire-and-forget Slack notification;
 *   nothing showed up in the internal in-app Inbox, so the loop was easily
 *   missed.
 * - On request_changes, the ball returned to 'internal' but assignee_id was
 *   left untouched (it may hold the client reviewer, or be null), so the
 *   task effectively had no usable internal owner.
 *
 * Fix under test:
 * - Both actions create an in-app notification (via the existing
 *   `_create_task_notification` RPC) addressed to task.created_by.
 * - request_changes resolves a real internal owner via resolveReturnAssignee
 *   and writes it back as assignee_id in the same update.
 *
 * These tests also cover the split between confirmation and write:
 * - Confirmation (reading the task, checking client membership, checking
 *   the task is actually in the client's court) happens on the logged-in
 *   user's own session.
 * - Writing (updating tasks, creating the in-app notification) happens on
 *   a server-side client, and only after confirmation succeeds.
 */

/** Builds a minimal (unsigned) JWT carrying only the claims checkAal2 reads. */
function jwt(payload: Record<string, unknown>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`
}

const mockUser = { id: 'client-user-1' }

const baseTask = {
  id: 'task-1',
  org_id: 'org-1',
  space_id: 'space-1',
  title: 'ロゴ制作',
  status: 'in_review',
  ball: 'client' as const,
  type: 'task' as const,
  estimated_cost: null as number | null,
  estimate_status: 'none' as 'none' | 'pending',
  created_by: 'internal-pm-1',
  assignee_id: 'client-reviewer-1',
}

let authResponse: { data: { user: (typeof mockUser & { factors?: Array<{ status: string }> }) | null } }
/** JWT access token used by the session's getSession() (drives the aal claim). */
let sessionAccessToken: string | null = null
let taskResponse: { data: typeof baseTask | null; error: null | { message: string } }
let clientMembershipResponse: { data: { id: string; role: string } | null; error: null }
let updateTaskResponse: { data: { id: string } | null; error: null | { message: string } }
let commentInsertResponse: { data: { id: string } | null; error: null | { message: string } }
/** トリガー(task_comments_notify)が作成者あてに作った comment_added 行の有無。既定は「無い」。 */
let existingNotificationResponse: { data: { id: string } | null; error: null | { message: string } }
let notificationUpdateResponse: { error: null | { message: string } }
/**
 * space_memberships lookup used by notifyApprovalRecipients (admin/service-role
 * client) to tell which of created_by/assignee_id are internal members of this
 * space — distinct from clientMembershipResponse above, which is the *session*
 * client's own-membership check used for access control.
 */
let approvalMembershipsResponse: {
  data: Array<{ user_id: string; role: string }> | null
  error: null | { message: string }
}
/**
 * org_memberships lookup used by notifyApprovalRecipients alongside
 * approvalMembershipsResponse — a candidate only counts as "internal" when the
 * org role is owner/admin/member (checked here) AND the space role (if any)
 * is not client/vendor (approvalMembershipsResponse above). Org members with
 * no space_memberships row at all count as 'editor'.
 */
let approvalOrgMembershipsResponse: {
  data: Array<{ user_id: string; role: string }> | null
  error: null | { message: string }
}

interface AdminUpdateCall {
  payload: Record<string, unknown>
  eqCalls: Array<[string, unknown]>
}

const adminUpdateCalls: AdminUpdateCall[] = []
const adminCommentInsertCalls: Array<Record<string, unknown>> = []
/** notifications への find(select)条件の記録。[to_user_id, channel, dedupe_key] の3条件を想定。 */
const notificationFindEqCalls: Array<Array<[string, unknown]>> = []
interface NotificationUpdateCall {
  payload: Record<string, unknown>
  eqCalls: Array<[string, unknown]>
}
const notificationUpdateCalls: NotificationUpdateCall[] = []
const approvalMembershipsQueryIds: unknown[][] = []
const approvalOrgMembershipsQueryIds: unknown[][] = []
/** notifications への delete() 条件の記録。[to_user_id, channel, dedupe_key] の3条件を想定。 */
const notificationDeleteCalls: Array<Array<[string, unknown]>> = []
let notificationDeleteResponse: { error: null | { message: string } }
/**
 * delete → create の実行順（課題2の回帰テスト用）。同じ配列に
 * `delete:<toUserId>` / `create:<toUserId>` を実行された順に積む。
 */
const sideEffectOrder: string[] = []

const createTaskNotificationMock = vi.fn((..._args: unknown[]) => {
  const notifyParams = _args[1] as { toUserId?: string } | undefined
  if (notifyParams?.toUserId) sideEffectOrder.push(`create:${notifyParams.toUserId}`)
  return Promise.resolve()
})
const createAuditLogMock = vi.fn((..._args: unknown[]) => Promise.resolve({ success: true }))
const resolveReturnAssigneeMock = vi.fn((..._args: unknown[]) => Promise.resolve('resolved-internal-owner'))

vi.mock('@/lib/audit', () => ({
  createAuditLog: (...args: unknown[]) => createAuditLogMock(...args),
  generateAuditSummary: vi.fn(() => 'summary'),
}))

vi.mock('@/lib/supabase/rpc', () => ({
  rpc: {
    createTaskNotification: (...args: unknown[]) => createTaskNotificationMock(...args),
  },
}))

vi.mock('@/app/api/portal/tasks/resolveReturnAssignee', () => ({
  resolveReturnAssignee: (...args: unknown[]) => resolveReturnAssigneeMock(...args),
}))

/** Records each `.eq()`/`.neq()` condition on a tasks UPDATE, plus the payload. */
function makeTasksUpdateBuilder(payload: Record<string, unknown>) {
  const eqCalls: Array<[string, unknown]> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  builder.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val])
    return builder
  })
  builder.neq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([`neq:${col}`, val])
    return builder
  })
  builder.select = vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(updateTaskResponse)),
  }))
  adminUpdateCalls.push({ payload, eqCalls })
  return builder
}

// Session client: used only to confirm who is acting and what they may act on
// (reading the task, checking client membership) plus the client-authored
// comment, never for writing task state.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
        // 二要素認証ガード(mfaGuardResponse)が読む。既定は未登録相当（factors無し）。
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
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(taskResponse)),
              })),
            })),
          }
        }
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve(clientMembershipResponse)),
                  })),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table on session client: ${table}`)
      }),
    })
  ),
}))

/**
 * task_comments の insert() は2つの呼び方に対応する必要がある:
 * - `await insert(...)` (estimate_reject: そのまま then で解決)
 * - `insert(...).select('id').single()` (request_changes: 挿入した id を受け取る)
 * どちらも同じ commentInsertResponse を返す。
 */
function makeCommentInsertResult() {
  const promise = Promise.resolve(commentInsertResponse)
  return {
    select: vi.fn(() => ({
      single: vi.fn(() => promise),
    })),
    then: promise.then.bind(promise),
  }
}

/** notifications の find(select) 条件を記録し、existingNotificationResponse を返す。 */
function makeNotificationSelectBuilder() {
  const eqCalls: Array<[string, unknown]> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  builder.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val])
    return builder
  })
  builder.maybeSingle = vi.fn(() => {
    notificationFindEqCalls.push(eqCalls)
    return Promise.resolve(existingNotificationResponse)
  })
  return builder
}

/** notifications の update() 条件・payload を記録し、notificationUpdateResponse を返す。 */
function makeNotificationUpdateBuilder(payload: Record<string, unknown>) {
  const eqCalls: Array<[string, unknown]> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  builder.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val])
    notificationUpdateCalls.push({ payload, eqCalls })
    return Promise.resolve(notificationUpdateResponse)
  })
  return builder
}

/**
 * notifications の delete() 条件を記録し、notificationDeleteResponse を返す。
 * 実物の PostgrestFilterBuilder と同じく、途中の `.eq()` チェーンのどこで
 * `await` されても解決できるよう `.then()` を持つ thenable にする。
 */
function makeNotificationDeleteBuilder() {
  const eqCalls: Array<[string, unknown]> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  builder.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val])
    return builder
  })
  builder.then = (
    resolve: (value: { error: null | { message: string } }) => unknown,
    reject: (reason: unknown) => unknown
  ) => {
    notificationDeleteCalls.push([...eqCalls])
    const toUserId = eqCalls.find(([col]) => col === 'to_user_id')?.[1]
    sideEffectOrder.push(`delete:${toUserId}`)
    return Promise.resolve(notificationDeleteResponse).then(resolve, reject)
  }
  return builder
}

// Server-side (service role) client: performs the actual writes, only once
// confirmation on the session client has passed.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'tasks') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => makeTasksUpdateBuilder(payload)),
        }
      }
      if (table === 'task_comments') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            adminCommentInsertCalls.push(payload)
            return makeCommentInsertResult()
          }),
        }
      }
      if (table === 'notifications') {
        return {
          select: vi.fn(() => makeNotificationSelectBuilder()),
          update: vi.fn((payload: Record<string, unknown>) => makeNotificationUpdateBuilder(payload)),
          delete: vi.fn(() => makeNotificationDeleteBuilder()),
        }
      }
      if (table === 'space_memberships') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn((_col: string, ids: unknown[]) => {
                approvalMembershipsQueryIds.push(ids)
                // Mirror real Postgres .in() filtering — the production code
                // relies on the query itself to narrow rows to the requested ids.
                const filtered = approvalMembershipsResponse.data
                  ? approvalMembershipsResponse.data.filter((row) => (ids as string[]).includes(row.user_id))
                  : null
                return Promise.resolve({ ...approvalMembershipsResponse, data: filtered })
              }),
            })),
          })),
        }
      }
      if (table === 'org_memberships') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn((_col: string, ids: unknown[]) => {
                approvalOrgMembershipsQueryIds.push(ids)
                const filtered = approvalOrgMembershipsResponse.data
                  ? approvalOrgMembershipsResponse.data.filter((row) => (ids as string[]).includes(row.user_id))
                  : null
                return Promise.resolve({ ...approvalOrgMembershipsResponse, data: filtered })
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table on admin client: ${table}`)
    }),
  })),
}))

const { POST } = await import('@/app/api/portal/tasks/[taskId]/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/portal/tasks/task-1', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ taskId: 'task-1' }) })
}

describe('POST /api/portal/tasks/[taskId] — in-app notification & assignee restore (H-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminUpdateCalls.length = 0
    adminCommentInsertCalls.length = 0
    notificationFindEqCalls.length = 0
    notificationUpdateCalls.length = 0
    notificationDeleteCalls.length = 0
    approvalMembershipsQueryIds.length = 0
    approvalOrgMembershipsQueryIds.length = 0
    sideEffectOrder.length = 0
    afterTasks.length = 0

    authResponse = { data: { user: mockUser } }
    sessionAccessToken = null
    taskResponse = { data: { ...baseTask }, error: null }
    clientMembershipResponse = { data: { id: 'membership-1', role: 'client' }, error: null }
    updateTaskResponse = { data: { id: 'task-1' }, error: null }
    commentInsertResponse = { data: { id: 'comment-1' }, error: null }
    // 既定は「トリガーが作った行は無い」= 従来どおり notifyTaskCreator が新規に作る
    existingNotificationResponse = { data: null, error: null }
    notificationUpdateResponse = { error: null }
    notificationDeleteResponse = { error: null }
    resolveReturnAssigneeMock.mockResolvedValue('resolved-internal-owner')
    // baseTask: created_by は社内(editor)、assignee_id は「相手先レビュアーを
    // 一時的に assignee_id に入れている」状態(role: client) — 承認通知は届かない側
    approvalMembershipsResponse = {
      data: [
        { user_id: 'internal-pm-1', role: 'editor' },
        { user_id: 'client-reviewer-1', role: 'client' },
      ],
      error: null,
    }
    // internal-pm-1 は組織の役割も member（=社内）。client-reviewer-1 は組織側でも
    // client 扱い（実際は org_memberships に行が無いことも多いが、無くても
    // orgInternalIds に入らないので結果は同じ）。
    approvalOrgMembershipsResponse = {
      data: [{ user_id: 'internal-pm-1', role: 'member' }],
      error: null,
    }
  })

  describe('confirm on session, write on server', () => {
    it('二要素認証が登録済み×コード未入力(aal1)なら止め、admin の書き込みは0回', async () => {
      authResponse = { data: { user: { ...mockUser, factors: [{ status: 'verified' }] } } }
      sessionAccessToken = jwt({ aal: 'aal1' })

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(403)
      expect(adminUpdateCalls).toHaveLength(0)
      expect(adminCommentInsertCalls).toHaveLength(0)
    })

    it('writes the task update through the server-side client, with the confirmed id/space_id/ball fixed as conditions', async () => {
      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(adminUpdateCalls).toHaveLength(1)
      const conditions = Object.fromEntries(adminUpdateCalls[0].eqCalls)
      expect(conditions).toMatchObject({
        id: 'task-1',
        space_id: 'space-1',
        ball: 'client',
        client_scope: 'deliverable',
      })
    })

    it('returns 401 and never reaches the server-side write when there is no session', async () => {
      authResponse = { data: { user: null } }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(401)
      expect(adminUpdateCalls).toHaveLength(0)
      expect(adminCommentInsertCalls).toHaveLength(0)
    })

    it('never reaches the server-side write when the task cannot be read on the session', async () => {
      taskResponse = { data: null, error: { message: 'not found' } }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(404)
      expect(adminUpdateCalls).toHaveLength(0)
    })

    it('never reaches the server-side write when the task is already done', async () => {
      taskResponse = { data: { ...baseTask, status: 'done' }, error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(409)
      expect(adminUpdateCalls).toHaveLength(0)
      expect(adminCommentInsertCalls).toHaveLength(0)
    })

    it('never reaches the server-side write when the task is not in the client\'s court', async () => {
      taskResponse = { data: { ...baseTask, ball: 'internal' as unknown as typeof baseTask.ball }, error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(409)
      expect(adminUpdateCalls).toHaveLength(0)
    })

    it('never reaches the server-side write when the user has no client membership on the space', async () => {
      clientMembershipResponse = { data: null, error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(403)
      expect(adminUpdateCalls).toHaveLength(0)
    })

    it('writes the client-authored comment through the server-side client, with the confirmed user id as the author', async () => {
      const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

      expect(response.status).toBe(200)
      expect(adminCommentInsertCalls).toHaveLength(1)
      expect(adminCommentInsertCalls[0]).toMatchObject({
        task_id: 'task-1',
        space_id: 'space-1',
        org_id: 'org-1',
        actor_id: mockUser.id,
        body: '色を直してください',
        visibility: 'client',
      })
    })

    it('never inserts the comment when the user has no client membership on the space', async () => {
      clientMembershipResponse = { data: null, error: null }

      const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

      expect(response.status).toBe(403)
      expect(adminCommentInsertCalls).toHaveLength(0)
    })

    it('passes the server-side client to the in-app notification RPC', async () => {
      await callPost({ action: 'approve' })

      expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
      const [clientArg] = createTaskNotificationMock.mock.calls[0]
      // Same object identity as what createAdminClient() returned.
      const adminModule = await import('@/lib/supabase/admin')
      const adminInstance = (adminModule.createAdminClient as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(clientArg).toBe(adminInstance)
    })
  })

  describe('approve', () => {
    it('creates a client_approved in-app notification addressed to the task creator (assignee is the client reviewer, so only the creator qualifies)', async () => {
      const response = await callPost({ action: 'approve' })
      expect(response.status).toBe(200)

      expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
      expect(createTaskNotificationMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 'org-1',
          spaceId: 'space-1',
          toUserId: 'internal-pm-1',
          type: 'client_approved',
          payload: expect.objectContaining({ task_id: 'task-1', task_title: 'ロゴ制作' }),
        })
      )
    })

    it('does not notify when the task has no recorded creator and the assignee is the client reviewer', async () => {
      taskResponse = { data: { ...baseTask, created_by: null as unknown as string }, error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    it('does not notify when the creator is the same person performing the approval and the assignee is the client reviewer', async () => {
      taskResponse = { data: { ...baseTask, created_by: mockUser.id }, error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    it('notifies both the creator and the assignee when the assignee is an internal member', async () => {
      taskResponse = { data: { ...baseTask, assignee_id: 'internal-dev-1' }, error: null }
      approvalMembershipsResponse = {
        data: [
          { user_id: 'internal-pm-1', role: 'editor' },
          { user_id: 'internal-dev-1', role: 'editor' },
        ],
        error: null,
      }
      approvalOrgMembershipsResponse = {
        data: [
          { user_id: 'internal-pm-1', role: 'member' },
          { user_id: 'internal-dev-1', role: 'member' },
        ],
        error: null,
      }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(approvalMembershipsQueryIds[0]).toEqual(
        expect.arrayContaining(['internal-pm-1', 'internal-dev-1'])
      )
      expect(createTaskNotificationMock).toHaveBeenCalledTimes(2)
      const calls = createTaskNotificationMock.mock.calls as Array<
        [unknown, { toUserId: string; type: string }]
      >
      const recipients = calls.map(([, args]) => args.toUserId)
      expect(recipients.sort()).toEqual(['internal-dev-1', 'internal-pm-1'])
      for (const [, args] of calls) {
        expect(args.type).toBe('client_approved')
      }
    })

    it('sends only one notification when the creator and assignee are the same internal person', async () => {
      taskResponse = { data: { ...baseTask, assignee_id: 'internal-pm-1' }, error: null }
      approvalMembershipsResponse = {
        data: [{ user_id: 'internal-pm-1', role: 'editor' }],
        error: null,
      }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
      expect(createTaskNotificationMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toUserId: 'internal-pm-1', type: 'client_approved' })
      )
    })

    it('does not notify a vendor assignee either', async () => {
      taskResponse = { data: { ...baseTask, created_by: null as unknown as string, assignee_id: 'vendor-1' }, error: null }
      approvalMembershipsResponse = { data: [{ user_id: 'vendor-1', role: 'vendor' }], error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    // 回帰: 組織の owner/admin がタスクを作ったが、その space に役割の行が無い
    // （よくある構成）場合、以前は space_memberships だけを見ていたので作成者が
    // 宛先から漏れていた（従来は作成者に必ず届いていたので後退）。
    // space の役割が無い組織メンバーは editor 扱い(app_is_space_internal と同じ考え方)。
    it('space の役割が無い組織admin/ownerの作成者にも届く', async () => {
      taskResponse = { data: { ...baseTask, created_by: 'org-admin-1' }, error: null }
      approvalMembershipsResponse = { data: [], error: null } // space_memberships に行が無い
      approvalOrgMembershipsResponse = {
        data: [{ user_id: 'org-admin-1', role: 'admin' }],
        error: null,
      }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
      expect(createTaskNotificationMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toUserId: 'org-admin-1', type: 'client_approved' })
      )
    })

    it('組織の役割が client の担当者には、space の役割が無くても届かない', async () => {
      taskResponse = {
        data: { ...baseTask, created_by: null as unknown as string, assignee_id: 'org-client-1' },
        error: null,
      }
      approvalMembershipsResponse = { data: [], error: null }
      approvalOrgMembershipsResponse = {
        data: [{ user_id: 'org-client-1', role: 'client' }],
        error: null,
      }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    it('space/組織のメンバー検索が失敗しても承認自体は成功し、失敗はログに残す（今は捨てて誰にも届かない・ログにも残らない不具合の回帰）', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      approvalMembershipsResponse = { data: null, error: { message: 'space lookup failed' } }
      approvalOrgMembershipsResponse = { data: null, error: { message: 'org lookup failed' } }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('space memberships'),
        expect.objectContaining({ message: 'space lookup failed' })
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('org memberships'),
        expect.objectContaining({ message: 'org lookup failed' })
      )

      consoleErrorSpy.mockRestore()
    })

    // 課題2: 2回目以降の承認でもプッシュ・即時メールが鳴るよう、宛先ごとに
    // 同じ dedupe_key の行を消してから作り直す（_create_task_notification は
    // 既存行があると insert でなく update に倒れ、プッシュが鳴らない）。
    describe('2回目以降の承認でも出るよう、消してから作り直す', () => {
      it('宛先ごとに、新しいキー(portal_client_approved:)で消してから作る（消す→作るの順）', async () => {
        const response = await callPost({ action: 'approve' })

        expect(response.status).toBe(200)
        expect(notificationDeleteCalls).toHaveLength(1)
        const deleteConditions = Object.fromEntries(notificationDeleteCalls[0])
        expect(deleteConditions).toMatchObject({
          to_user_id: 'internal-pm-1',
          channel: 'in_app',
          dedupe_key: 'portal_client_approved:task-1:internal-pm-1',
        })
        expect(createTaskNotificationMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ dedupeKey: 'portal_client_approved:task-1:internal-pm-1' })
        )
        expect(sideEffectOrder).toEqual(['delete:internal-pm-1', 'create:internal-pm-1'])
      })

      it('消すのに失敗しても、通知の作成は続ける（ログに残すだけ）', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        notificationDeleteResponse = { error: { message: 'delete failed' } }

        const response = await callPost({ action: 'approve' })

        expect(response.status).toBe(200)
        expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
        expect(consoleErrorSpy).toHaveBeenCalled()

        consoleErrorSpy.mockRestore()
      })
    })
  })

  describe('request_changes', () => {
    it('resolves a real internal owner and writes it back as assignee_id', async () => {
      const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

      expect(response.status).toBe(200)
      expect(resolveReturnAssigneeMock).toHaveBeenCalledWith(
        expect.anything(),
        { spaceId: 'space-1', assigneeId: 'client-reviewer-1', createdBy: 'internal-pm-1' }
      )

      // The first update() call on 'tasks' is the ball/assignee transfer.
      expect(adminUpdateCalls[0].payload).toMatchObject({
        ball: 'internal',
        assignee_id: 'resolved-internal-owner',
      })
    })

    it('creates an in-app "ball_passed" notification with the client comment as the message', async () => {
      const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
      expect(createTaskNotificationMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          toUserId: 'internal-pm-1',
          type: 'ball_passed',
          payload: expect.objectContaining({ message: '色を直してください' }),
        })
      )
    })

    it('does not notify and reverts assignee_id when the comment insert fails', async () => {
      commentInsertResponse = { data: null, error: { message: 'insert failed' } }

      const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

      expect(response.status).toBe(500)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()

      // コメントの保存に失敗して ball を戻した場合、「修正を依頼した」という
      // 監査ログ・Slack通知を after() に登録してはいけない（相手先にも見える
      // visibility='client' の履歴に、実際には起きなかった操作が残るのを防ぐ）。
      expect(mockAfter).not.toHaveBeenCalled()
      expect(createAuditLogMock).not.toHaveBeenCalled()

      // Second update() call is the rollback; must restore the original assignee,
      // scoped to the same confirmed space and the ball value it is reverting from.
      expect(adminUpdateCalls[1].payload).toMatchObject({
        ball: 'client',
        assignee_id: 'client-reviewer-1',
      })
      const rollbackConditions = Object.fromEntries(adminUpdateCalls[1].eqCalls)
      expect(rollbackConditions).toMatchObject({ id: 'task-1', space_id: 'space-1', ball: 'internal' })
      // The rollback's updated_at guard must match the forward update's timestamp
      // (so it never clobbers a newer state written in between).
      expect(rollbackConditions.updated_at).toBe(adminUpdateCalls[0].payload.updated_at)
    })

    // 課題4: request_changes のコメント insert は task_comments_notify トリガーを
    // 発火させ、作成者が担当者・承認者・過去の書き手のいずれかに該当するときは
    // 既に comment_added の通知を作っている。そこへ notifyTaskCreator で
    // ball_passed をさらに作ると、同じ人に2通（プッシュも2回）届いてしまう。
    describe('作成者あての通知はトリガーの行を書き換えて1通にまとめる', () => {
      it('トリガーが作った行が見つかれば、ball_passed に書き換えて notifyTaskCreator は呼ばない', async () => {
        existingNotificationResponse = { data: { id: 'notif-1' }, error: null }

        const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

        expect(response.status).toBe(200)
        expect(createTaskNotificationMock).not.toHaveBeenCalled()

        expect(notificationUpdateCalls).toHaveLength(1)
        expect(notificationUpdateCalls[0].payload).toMatchObject({
          type: 'ball_passed',
          read_at: null,
          actioned_at: null,
        })
        const updatePayload = notificationUpdateCalls[0].payload as { payload: Record<string, unknown> }
        expect(updatePayload.payload).toMatchObject({
          task_id: 'task-1',
          task_title: 'ロゴ制作',
          title: '「ロゴ制作」に修正依頼が届きました',
          message: '色を直してください',
          comment_id: 'comment-1',
        })
        const updateConditions = Object.fromEntries(notificationUpdateCalls[0].eqCalls)
        expect(updateConditions).toMatchObject({ id: 'notif-1' })
      })

      it('探す条件は、insert した comment の id を dedupe_key に使い、作成者・in_app に絞る', async () => {
        existingNotificationResponse = { data: { id: 'notif-1' }, error: null }

        await callPost({ action: 'request_changes', comment: '色を直してください' })

        expect(notificationFindEqCalls).toHaveLength(1)
        const findConditions = Object.fromEntries(notificationFindEqCalls[0])
        expect(findConditions).toMatchObject({
          to_user_id: 'internal-pm-1',
          channel: 'in_app',
          dedupe_key: 'task_comment:comment-1',
        })
      })

      it('トリガーが作った行が見つからなければ、従来どおり notifyTaskCreator を呼ぶ', async () => {
        existingNotificationResponse = { data: null, error: null }

        const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

        expect(response.status).toBe(200)
        expect(notificationUpdateCalls).toHaveLength(0)
        expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
        expect(createTaskNotificationMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ toUserId: 'internal-pm-1', type: 'ball_passed' })
        )
      })

      // 探せなかったときは、作成者に届いているか分からない。修正依頼は相手先が待っている知らせなので、
      // 1通も届かないより2通になるほうを選び、従来どおり notifyTaskCreator で送る
      it('探すときに失敗したら、依頼自体は成功で返し、従来どおり notifyTaskCreator で送る', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        existingNotificationResponse = { data: null, error: { message: 'boom' } }

        const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

        expect(response.status).toBe(200)
        expect(notificationUpdateCalls).toHaveLength(0)
        expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
        expect(consoleErrorSpy).toHaveBeenCalled()

        consoleErrorSpy.mockRestore()
      })

      // 見つかった行の書き換えに失敗しても、作成者にはトリガーのコメントの通知がもう届いている。二重にしない
      it('見つかった行の書き換えに失敗したら、依頼自体は成功で返し、notifyTaskCreator は呼ばない', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        existingNotificationResponse = { data: { id: 'notif-1' }, error: null }
        notificationUpdateResponse = { error: { message: 'boom' } }

        const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

        expect(response.status).toBe(200)
        expect(notificationUpdateCalls).toHaveLength(1)
        expect(createTaskNotificationMock).not.toHaveBeenCalled()
        expect(consoleErrorSpy).toHaveBeenCalled()

        consoleErrorSpy.mockRestore()
      })
    })
  })

  describe('estimate_approve / estimate_reject', () => {
    const pendingEstimateTask = {
      ...baseTask,
      estimate_status: 'pending' as const,
      estimated_cost: 50000,
    }

    it('estimate_approve の UPDATE 条件が id・space_id・ball・estimate_status・client_scope で固定される', async () => {
      taskResponse = { data: pendingEstimateTask, error: null }

      const response = await callPost({ action: 'estimate_approve' })

      expect(response.status).toBe(200)
      expect(adminUpdateCalls).toHaveLength(1)
      const conditions = Object.fromEntries(adminUpdateCalls[0].eqCalls)
      expect(conditions).toMatchObject({
        id: 'task-1',
        space_id: 'space-1',
        ball: 'client',
        estimate_status: 'pending',
        client_scope: 'deliverable',
      })
    })

    it('estimate_approve は見積もりが確認待ちでなければ 409 で admin の書き込みは0回', async () => {
      taskResponse = { data: { ...baseTask, estimate_status: 'none' }, error: null }

      const response = await callPost({ action: 'estimate_approve' })

      expect(response.status).toBe(409)
      expect(adminUpdateCalls).toHaveLength(0)
    })

    it('estimate_reject の UPDATE 条件が id・space_id・ball・estimate_status・client_scope で固定される', async () => {
      taskResponse = { data: pendingEstimateTask, error: null }

      const response = await callPost({ action: 'estimate_reject', comment: '再検討をお願いします' })

      expect(response.status).toBe(200)
      const conditions = Object.fromEntries(adminUpdateCalls[0].eqCalls)
      expect(conditions).toMatchObject({
        id: 'task-1',
        space_id: 'space-1',
        ball: 'client',
        estimate_status: 'pending',
        client_scope: 'deliverable',
      })
    })

    it('estimate_reject は見積もりが確認待ちでなければ 409 で admin の書き込みは0回', async () => {
      taskResponse = { data: { ...baseTask, estimate_status: 'none' }, error: null }

      const response = await callPost({ action: 'estimate_reject', comment: '再検討をお願いします' })

      expect(response.status).toBe(409)
      expect(adminUpdateCalls).toHaveLength(0)
    })

    it('estimate_reject でコメントの INSERT が失敗したら、確認済みの条件で見積状態を戻す', async () => {
      taskResponse = { data: pendingEstimateTask, error: null }
      commentInsertResponse = { data: null, error: { message: 'insert failed' } }

      const response = await callPost({ action: 'estimate_reject', comment: '再検討をお願いします' })

      expect(response.status).toBe(500)
      expect(adminUpdateCalls).toHaveLength(2)
      const rollbackConditions = Object.fromEntries(adminUpdateCalls[1].eqCalls)
      expect(rollbackConditions).toMatchObject({ id: 'task-1', space_id: 'space-1', estimate_status: 'rejected' })
      expect(rollbackConditions.updated_at).toBe(adminUpdateCalls[0].payload.updated_at)

      // コメントの保存に失敗して見積状態を戻した場合、「再見積もりを依頼した」
      // という監査ログ・Slack通知を after() に登録してはいけない。
      expect(mockAfter).not.toHaveBeenCalled()
      expect(createAuditLogMock).not.toHaveBeenCalled()
    })

    it('見積もりのコメントも visibility=client・確認済みの org_id で INSERT される', async () => {
      taskResponse = { data: pendingEstimateTask, error: null }

      const response = await callPost({ action: 'estimate_reject', comment: '再検討をお願いします' })

      expect(response.status).toBe(200)
      expect(adminCommentInsertCalls[0]).toMatchObject({
        task_id: 'task-1',
        org_id: 'org-1',
        space_id: 'space-1',
        visibility: 'client',
      })
    })
  })

  // S5: レビュー整合性 — DBトリガー enforce_review_gate は open/blocked の
  // 社内承認や未決の spec decision_state を持つタスクの status→'done' を
  // 拒否する。ポータルの approve は素の Postgres 例外をそのままクライアントに
  // 見せず、409＋分かりやすい日本語メッセージに変換する。
  describe('approve — 社内レビュー未完了時のトリガーエラーを409に変換する (S5)', () => {
    it('review が open/blocked で完了できない場合、409と専用メッセージを返す', async () => {
      updateTaskResponse = {
        data: null,
        error: { message: 'Cannot complete task: review is not approved' },
      }

      const response = await callPost({ action: 'approve' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error).toBe('社内レビューが完了していないため承認できません')
      // 業務ルールで止まっている(=他の誰かが先に操作したわけではない)ことを
      // 画面側が区別できるよう、理由付きの reason を返す。
      expect(body.reason).toBe('blocked')
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    it('spec の決定事項が未決で完了できない場合、409と専用メッセージを返す', async () => {
      updateTaskResponse = {
        data: null,
        error: { message: 'Cannot complete task: spec decision is not made' },
      }

      const response = await callPost({ action: 'approve' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error).toBe('決定事項が未決のため承認できません')
      expect(body.reason).toBe('blocked')
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    it('その他の理由で行が更新されない場合は、従来どおり汎用メッセージを返す（reason は付けない＝先に操作された扱い）', async () => {
      updateTaskResponse = { data: null, error: null }

      const response = await callPost({ action: 'approve' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error).toBe('タスクの状態が変更されました。ページを再読み込みしてください。')
      expect(body.reason).toBeUndefined()
    })
  })

  // 見積もりが確認待ちのまま approve/request_changes を叩いた場合の 409 も、
  // 業務ルールで止まっている(reason: 'blocked')ため、画面はその理由をそのまま出す。
  describe('approve/request_changes — 見積もり確認待ちで止まる場合', () => {
    it('見積もり確認が必要な旨と reason: blocked を返す（approve）', async () => {
      taskResponse = { data: { ...baseTask, estimate_status: 'pending', estimated_cost: 50000 }, error: null }

      const response = await callPost({ action: 'approve' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error).toBe('見積もりの確認が必要です。見積もりを承認または再見積もり依頼してください。')
      expect(body.reason).toBe('blocked')
      expect(adminUpdateCalls).toHaveLength(0)
    })

    it('見積もり確認が必要な旨と reason: blocked を返す（request_changes）', async () => {
      taskResponse = { data: { ...baseTask, estimate_status: 'pending', estimated_cost: 50000 }, error: null }

      const response = await callPost({ action: 'request_changes', comment: 'コメント' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error).toBe('見積もりの確認が必要です。見積もりを承認または再見積もり依頼してください。')
      expect(body.reason).toBe('blocked')
      expect(adminUpdateCalls).toHaveLength(0)
    })
  })

  // 監査ログ・Slack通知は応答を返したあとも確実に実行されるよう after() に回す
  // （await しない書き込みは Vercel 上で応答送出後に打ち切られることがある —
  // 本番で「依頼を作っても audit_logs が0件」という形で確認された不具合の回帰テスト）。
  describe('監査ログ・Slack通知は after() 経由で実行される', () => {
    it('approve: 応答時点ではまだ実行されず、after() のタスクを実行して初めて監査ログが記録される', async () => {
      const response = await callPost({ action: 'approve' })
      expect(response.status).toBe(200)

      // 応答が返った時点では、まだキューに積まれているだけで実行されていない
      // （直接 createAuditLog を呼ぶ実装に戻っても検知できるよう、ここで確認する）。
      expect(mockAfter).toHaveBeenCalledTimes(2)
      expect(createAuditLogMock).not.toHaveBeenCalled()

      await runAfterTasks()

      expect(createAuditLogMock).toHaveBeenCalledTimes(1)
      expect(createAuditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          spaceId: 'space-1',
          actorId: mockUser.id,
          eventType: 'approval.approved',
          targetId: 'task-1',
        })
      )
    })

    it('request_changes: 応答時点ではまだ実行されず、after() のタスクを実行して初めて監査ログが記録される', async () => {
      const response = await callPost({ action: 'request_changes', comment: '直してください' })
      expect(response.status).toBe(200)

      expect(mockAfter).toHaveBeenCalledTimes(2)
      expect(createAuditLogMock).not.toHaveBeenCalled()

      await runAfterTasks()

      expect(createAuditLogMock).toHaveBeenCalledTimes(1)
      expect(createAuditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          spaceId: 'space-1',
          actorId: mockUser.id,
          eventType: 'approval.changes_requested',
          targetId: 'task-1',
        })
      )
    })

    it('estimate_approve: 応答時点ではまだ実行されず、after() のタスクを実行して初めて監査ログが記録される', async () => {
      taskResponse = { data: { ...baseTask, estimate_status: 'pending', estimated_cost: 50000 }, error: null }
      const response = await callPost({ action: 'estimate_approve' })
      expect(response.status).toBe(200)

      expect(mockAfter).toHaveBeenCalledTimes(2)
      expect(createAuditLogMock).not.toHaveBeenCalled()

      await runAfterTasks()

      expect(createAuditLogMock).toHaveBeenCalledTimes(1)
      expect(createAuditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          spaceId: 'space-1',
          actorId: mockUser.id,
          eventType: 'estimate.approved',
          targetId: 'task-1',
        })
      )
    })

    it('estimate_reject: 応答時点ではまだ実行されず、after() のタスクを実行して初めて監査ログが記録される', async () => {
      taskResponse = { data: { ...baseTask, estimate_status: 'pending', estimated_cost: 50000 }, error: null }
      const response = await callPost({ action: 'estimate_reject', comment: '再検討をお願いします' })
      expect(response.status).toBe(200)

      expect(mockAfter).toHaveBeenCalledTimes(2)
      expect(createAuditLogMock).not.toHaveBeenCalled()

      await runAfterTasks()

      expect(createAuditLogMock).toHaveBeenCalledTimes(1)
      expect(createAuditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          spaceId: 'space-1',
          actorId: mockUser.id,
          eventType: 'estimate.rejected',
          targetId: 'task-1',
        })
      )
    })
  })
})
