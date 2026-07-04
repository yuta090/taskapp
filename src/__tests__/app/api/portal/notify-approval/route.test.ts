import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Security regression tests for /api/portal/notify-approval.
 *
 * Vulnerability: the endpoint only checked "is there a session", then used the
 * service-role client to read an arbitrary `taskId` (and trusted a body-supplied
 * `spaceId`) without verifying the caller actually belongs to that task's
 * org/space. An authenticated attacker could pass another org's taskId and get
 * an approval-token email sent to that org's client.
 *
 * Fix under test:
 * - spaceId is derived from the fetched task, never trusted from the body.
 * - Caller must be an internal (non-client) member of the task's org or space,
 *   verified via the caller's own session client (not the admin client).
 * - Non-members get 403 with zero side effects (no token insert, no email).
 */

const mockUser = { id: 'user-1' }

const mockTask = {
  id: 'task-1',
  title: 'テストタスク',
  org_id: 'org-1',
  space_id: 'space-1',
  ball: 'client' as const,
  estimate_status: 'approved',
  estimated_cost: null,
  due_date: null as string | null,
  description: null as string | null,
}

let authResponse: { data: { user: typeof mockUser | null } }
let taskResponse: { data: typeof mockTask | null; error: null | { message: string } }
let orgMembershipResponse: { data: { role: string } | null; error: null | { message: string } }
let spaceMembershipResponse: { data: { role: string } | null; error: null | { message: string } }
let taskOwnersResponse: { data: { user_id: string }[] | null; error: null }
let clientMembersResponse: { data: { user_id: string }[] | null; error: null }
let profilesResponse: { data: { id: string; email: string }[] | null; error: null }
let spaceResponse: { data: Record<string, unknown> | null; error: null }
let tokenInsertResponse: { data: { token: string } | null; error: null | { message: string } }

const tokenInsertMock = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(tokenInsertResponse)),
  })),
}))

const tokenUpdateIsMock = vi.fn(() => Promise.resolve({ error: null }))

const sendApprovalEmailMock = vi.fn(() => Promise.resolve())

vi.mock('@/lib/email/approval', () => ({
  sendApprovalEmail: (...args: unknown[]) => sendApprovalEmailMock(...args),
}))

// Session-scoped client (RLS-respecting) used for authorization checks.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  neq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve(orgMembershipResponse)),
                    maybeSingle: vi.fn(() => Promise.resolve(orgMembershipResponse)),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  neq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve(spaceMembershipResponse)),
                    maybeSingle: vi.fn(() => Promise.resolve(spaceMembershipResponse)),
                  })),
                })),
              })),
            })),
          }
        }
        return {}
      }),
    })
  ),
}))

// Service-role client used only for reading task/recipient data and writing
// tokens once authorization has already been established.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: vi.fn(() => Promise.resolve({ data: { user: null } })),
      },
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
      if (table === 'task_owners') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve(taskOwnersResponse)),
            })),
          })),
        }
      }
      if (table === 'space_memberships') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve(clientMembersResponse)),
            })),
          })),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve(profilesResponse)),
          })),
        }
      }
      if (table === 'spaces') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve(spaceResponse)),
            })),
          })),
        }
      }
      if (table === 'email_action_tokens') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                is: tokenUpdateIsMock,
              })),
            })),
          })),
          insert: tokenInsertMock,
        }
      }
      return {}
    }),
  })),
}))

const { POST } = await import('@/app/api/portal/notify-approval/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/portal/notify-approval', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('POST /api/portal/notify-approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authResponse = { data: { user: mockUser } }
    taskResponse = { data: mockTask, error: null }
    orgMembershipResponse = { data: null, error: null }
    spaceMembershipResponse = { data: null, error: null }
    taskOwnersResponse = { data: [{ user_id: 'client-user-1' }], error: null }
    clientMembersResponse = { data: [], error: null }
    profilesResponse = { data: [{ id: 'client-user-1', email: 'client@example.com' }], error: null }
    spaceResponse = {
      data: { name: 'テストスペース', org_id: 'org-1', organizations: { name: 'テスト組織' } },
      error: null,
    }
    tokenInsertResponse = { data: { token: 'generated-token' }, error: null }
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callPost({ taskId: 'task-1', spaceId: 'space-1' })

    expect(response.status).toBe(401)
    expect(tokenInsertMock).not.toHaveBeenCalled()
    expect(sendApprovalEmailMock).not.toHaveBeenCalled()
  })

  it('returns 403 and performs no side effects when the caller is not a member of the task org/space', async () => {
    orgMembershipResponse = { data: null, error: null }
    spaceMembershipResponse = { data: null, error: null }

    const response = await callPost({ taskId: 'task-1', spaceId: 'space-1' })

    expect(response.status).toBe(403)
    expect(tokenInsertMock).not.toHaveBeenCalled()
    expect(sendApprovalEmailMock).not.toHaveBeenCalled()
  })

  it('ignores a body-supplied spaceId that differs from the task and still enforces authorization on the real org/space', async () => {
    // Attacker passes another org's taskId, but supplies a spaceId of a space
    // they legitimately belong to, hoping stale code paths use the body value
    // instead of the task's real space. They are not a member of task-1's
    // actual org/space, so this must still be rejected.
    orgMembershipResponse = { data: null, error: null }
    spaceMembershipResponse = { data: null, error: null } // not a member of task-1's real space-1 either

    const response = await callPost({ taskId: 'task-1', spaceId: 'attacker-owned-space' })

    expect(response.status).toBe(403)
    expect(tokenInsertMock).not.toHaveBeenCalled()
    expect(sendApprovalEmailMock).not.toHaveBeenCalled()
  })

  it('allows a legitimate internal space member and derives spaceId from the task, not the body', async () => {
    spaceMembershipResponse = { data: { role: 'editor' }, error: null }

    const response = await callPost({ taskId: 'task-1', spaceId: 'some-other-space-id' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(tokenInsertMock).toHaveBeenCalledTimes(1)
    expect(tokenInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'task-1', space_id: 'space-1' })
    )
    expect(sendApprovalEmailMock).toHaveBeenCalledTimes(1)
  })

  it('allows a legitimate internal org member even without a direct space membership row', async () => {
    orgMembershipResponse = { data: { role: 'member' }, error: null }
    spaceMembershipResponse = { data: null, error: null }

    const response = await callPost({ taskId: 'task-1', spaceId: 'space-1' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(tokenInsertMock).toHaveBeenCalledTimes(1)
    expect(sendApprovalEmailMock).toHaveBeenCalledTimes(1)
  })

  it('passes the task due date and a 120-character description excerpt to the approval email', async () => {
    spaceMembershipResponse = { data: { role: 'editor' }, error: null }
    taskResponse = {
      data: {
        ...mockTask,
        due_date: '2026-07-10',
        description: 'a'.repeat(200),
      },
      error: null,
    }

    const response = await callPost({ taskId: 'task-1', spaceId: 'space-1' })

    expect(response.status).toBe(200)
    expect(sendApprovalEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: '2026-07-10',
        descriptionExcerpt: 'a'.repeat(120),
      })
    )
  })

  it('passes null due date/description excerpt when the task has none', async () => {
    spaceMembershipResponse = { data: { role: 'editor' }, error: null }
    taskResponse = { data: { ...mockTask, due_date: null, description: null }, error: null }

    const response = await callPost({ taskId: 'task-1', spaceId: 'space-1' })

    expect(response.status).toBe(200)
    expect(sendApprovalEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: null,
        descriptionExcerpt: null,
      })
    )
  })

  it('returns 404 without checking membership when the task does not exist', async () => {
    taskResponse = { data: null, error: { message: 'not found' } }

    const response = await callPost({ taskId: 'nonexistent-task', spaceId: 'space-1' })

    expect(response.status).toBe(404)
    expect(tokenInsertMock).not.toHaveBeenCalled()
    expect(sendApprovalEmailMock).not.toHaveBeenCalled()
  })
})
