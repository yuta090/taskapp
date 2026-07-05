import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Regression tests for the "0-row update treated as success" race-condition fix.
 *
 * The POST handler performs a state-conditioned `tasks` update
 * (`.eq('ball','client').neq('status','done')...select('id').maybeSingle()`).
 * - updateError (real DB error)      -> 500, no side effects
 * - !updated (0 rows matched = race) -> 409, no side effects
 * - updated (1 row)                  -> 200 + audit log + Slack notify + token expiry
 */

// ---- Mock fixtures ----

const baseTokenRecord = {
  id: 'token-id-1',
  token: 'valid-token',
  task_id: 'task-1',
  space_id: 'space-1',
  org_id: 'org-1',
  recipient_user_id: 'user-1',
  recipient_email: 'client@example.com',
  used_at: null as string | null,
  expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
}

const approveTokenRecord = { ...baseTokenRecord, action_type: 'approve' as const }
const estimateApproveTokenRecord = { ...baseTokenRecord, action_type: 'estimate_approve' as const }

const approveTask = {
  id: 'task-1',
  title: 'テストタスク',
  org_id: 'org-1',
  space_id: 'space-1',
  status: 'in_progress',
  ball: 'client',
  estimate_status: 'approved',
  estimated_cost: null,
}

const estimateApproveTask = {
  ...approveTask,
  estimate_status: 'pending',
}

let tokenSelectResponse: { data: typeof baseTokenRecord | null; error: null | { message: string } }
let taskSelectResponse: { data: typeof approveTask | null; error: null | { message: string } }
let taskUpdateResponse: { data: { id: string } | null; error: null | { message: string } }
let tokenUpdateEqMock: ReturnType<typeof vi.fn>

// The chain object created the last time `tasks.update(...)` was invoked.
// Exposed so tests can assert on the CAS conditions applied (.eq/.neq calls).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastTaskUpdateChain: any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTaskUpdateChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  chain.eq = vi.fn(() => chain)
  chain.neq = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve(taskUpdateResponse))
  return chain
}

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
  generateAuditSummary: vi.fn(() => 'summary'),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'email_action_tokens') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve(tokenSelectResponse)),
            })),
          })),
          update: vi.fn(() => ({
            eq: tokenUpdateEqMock,
          })),
        }
      }
      if (table === 'tasks') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve(taskSelectResponse)),
            })),
          })),
          update: vi.fn(() => {
            lastTaskUpdateChain = buildTaskUpdateChain()
            return lastTaskUpdateChain
          }),
        }
      }
      return {}
    }),
  })),
}))

const { createAuditLog } = await import('@/lib/audit')
const { POST } = await import('@/app/api/portal/email-action/[token]/route')

function callPost(token = 'valid-token') {
  const request = new NextRequest(
    new URL(`/api/portal/email-action/${token}`, 'http://localhost:3000')
  )
  return POST(request, { params: Promise.resolve({ token }) })
}

describe('POST /api/portal/email-action/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.INTERNAL_NOTIFY_SECRET = 'test-secret'
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

    tokenSelectResponse = { data: approveTokenRecord, error: null }
    taskSelectResponse = { data: approveTask, error: null }
    taskUpdateResponse = { data: { id: 'task-1' }, error: null }
    tokenUpdateEqMock = vi.fn(() => Promise.resolve({ error: null }))
  })

  afterEach(() => {
    delete process.env.INTERNAL_NOTIFY_SECRET
  })

  describe('approve', () => {
    it('returns 200, records the audit log, notifies Slack and expires the token when exactly one row is updated', async () => {
      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      expect(createAuditLog).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(tokenUpdateEqMock).toHaveBeenCalledWith('id', approveTokenRecord.id)

      // CAS condition: approve must guard against a pending estimate
      expect(lastTaskUpdateChain.neq).toHaveBeenCalledWith('estimate_status', 'pending')
      expect(lastTaskUpdateChain.neq).toHaveBeenCalledWith('status', 'done')
    })

    it('returns 409 and performs no side effects when the update matches 0 rows (race condition)', async () => {
      taskUpdateResponse = { data: null, error: null }

      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toBe('タスクの状態が変更されました')

      expect(createAuditLog).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
      expect(tokenUpdateEqMock).not.toHaveBeenCalled()
    })

    it('returns 500 and performs no side effects when the update fails with a DB error', async () => {
      taskUpdateResponse = { data: null, error: { message: 'DB error' } }

      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('サーバーエラー')

      expect(createAuditLog).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
      expect(tokenUpdateEqMock).not.toHaveBeenCalled()
    })

    it('marks the token as used immediately after the task CAS succeeds, before the audit log and Slack notification', async () => {
      const response = await callPost()
      expect(response.status).toBe(200)

      const tokenOrder = tokenUpdateEqMock.mock.invocationCallOrder[0]
      const auditOrder = (createAuditLog as unknown as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]
      const slackOrder = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]

      expect(tokenOrder).toBeLessThan(auditOrder)
      expect(tokenOrder).toBeLessThan(slackOrder)
    })

    it('still returns success and logs the error when marking the token as used fails', async () => {
      tokenUpdateEqMock = vi.fn(() => Promise.resolve({ error: { message: 'DB error' } }))
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('estimate_approve', () => {
    beforeEach(() => {
      tokenSelectResponse = { data: estimateApproveTokenRecord, error: null }
      taskSelectResponse = { data: estimateApproveTask, error: null }
    })

    it('returns 200, records the audit log, notifies Slack and expires the token when exactly one row is updated', async () => {
      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      expect(createAuditLog).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(tokenUpdateEqMock).toHaveBeenCalledWith('id', estimateApproveTokenRecord.id)

      // CAS condition: estimate_approve must guard against an already-completed task
      expect(lastTaskUpdateChain.neq).toHaveBeenCalledWith('status', 'done')
    })

    it('returns 409 and performs no side effects when the update matches 0 rows (race condition)', async () => {
      taskUpdateResponse = { data: null, error: null }

      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toBe('タスクの状態が変更されました')

      expect(createAuditLog).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
      expect(tokenUpdateEqMock).not.toHaveBeenCalled()
    })

    it('returns 500 and performs no side effects when the update fails with a DB error', async () => {
      taskUpdateResponse = { data: null, error: { message: 'DB error' } }

      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('サーバーエラー')

      expect(createAuditLog).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
      expect(tokenUpdateEqMock).not.toHaveBeenCalled()
    })
  })
})
