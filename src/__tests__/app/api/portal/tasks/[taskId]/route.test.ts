import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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
 */

const mockUser = { id: 'client-user-1' }

const baseTask = {
  id: 'task-1',
  org_id: 'org-1',
  space_id: 'space-1',
  title: 'ロゴ制作',
  status: 'in_review',
  ball: 'client' as const,
  type: 'task' as const,
  estimated_cost: null,
  estimate_status: 'none' as const,
  created_by: 'internal-pm-1',
  assignee_id: 'client-reviewer-1',
}

let authResponse: { data: { user: typeof mockUser | null } }
let taskResponse: { data: typeof baseTask | null; error: null | { message: string } }
let clientMembershipResponse: { data: { id: string; role: string } | null; error: null }
let updateTaskResponse: { data: { id: string } | null; error: null | { message: string } }
let commentInsertResponse: { error: null | { message: string } }

const updateCalls: Array<Record<string, unknown>> = []

const createTaskNotificationMock = vi.fn(() => Promise.resolve())
const createAuditLogMock = vi.fn(() => Promise.resolve({ success: true }))
const resolveReturnAssigneeMock = vi.fn(() => Promise.resolve('resolved-internal-owner'))

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

function makeTasksUpdateBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  builder.eq = vi.fn(() => builder)
  builder.neq = vi.fn(() => builder)
  builder.select = vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(updateTaskResponse)),
  }))
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(taskResponse)),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              updateCalls.push(payload)
              return makeTasksUpdateBuilder()
            }),
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
        if (table === 'task_comments') {
          return {
            insert: vi.fn(() => Promise.resolve(commentInsertResponse)),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
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
    updateCalls.length = 0

    authResponse = { data: { user: mockUser } }
    taskResponse = { data: { ...baseTask }, error: null }
    clientMembershipResponse = { data: { id: 'membership-1', role: 'client' }, error: null }
    updateTaskResponse = { data: { id: 'task-1' }, error: null }
    commentInsertResponse = { error: null }
    resolveReturnAssigneeMock.mockResolvedValue('resolved-internal-owner')
  })

  describe('approve', () => {
    it('creates an in-app notification addressed to the task creator', async () => {
      const response = await callPost({ action: 'approve' })
      expect(response.status).toBe(200)

      expect(createTaskNotificationMock).toHaveBeenCalledTimes(1)
      expect(createTaskNotificationMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 'org-1',
          spaceId: 'space-1',
          toUserId: 'internal-pm-1',
          type: 'task_completed',
          payload: expect.objectContaining({ task_id: 'task-1', task_title: 'ロゴ制作' }),
        })
      )
    })

    it('does not notify when the task has no recorded creator', async () => {
      taskResponse = { data: { ...baseTask, created_by: null as unknown as string }, error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    it('does not notify when the creator is the same person performing the approval', async () => {
      taskResponse = { data: { ...baseTask, created_by: mockUser.id }, error: null }

      const response = await callPost({ action: 'approve' })

      expect(response.status).toBe(200)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
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
      expect(updateCalls[0]).toMatchObject({
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
      commentInsertResponse = { error: { message: 'insert failed' } }

      const response = await callPost({ action: 'request_changes', comment: '色を直してください' })

      expect(response.status).toBe(500)
      expect(createTaskNotificationMock).not.toHaveBeenCalled()

      // Second update() call is the rollback; must restore the original assignee.
      expect(updateCalls[1]).toMatchObject({
        ball: 'client',
        assignee_id: 'client-reviewer-1',
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
      expect(createTaskNotificationMock).not.toHaveBeenCalled()
    })

    it('その他の理由で行が更新されない場合は、従来どおり汎用メッセージを返す', async () => {
      updateTaskResponse = { data: null, error: null }

      const response = await callPost({ action: 'approve' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error).toBe('タスクの状態が変更されました。ページを再読み込みしてください。')
    })
  })
})
