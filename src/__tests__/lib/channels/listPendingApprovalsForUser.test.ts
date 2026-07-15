import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * listPendingApprovalsForUser / promoteDigestTask / rejectDigestTask（Stage 2.7-B §5 コンソール層）
 */

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
}))

const { listPendingApprovalsForUser, promoteDigestTask, rejectDigestTask } = await import(
  '@/lib/channels/store'
)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listPendingApprovalsForUser', () => {
  it('認可ファーストRPC rpc_list_pending_approvals に org と本人を渡す', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await listPendingApprovalsForUser('org-1', 'user-1')
    expect(rpcMock).toHaveBeenCalledWith('rpc_list_pending_approvals', {
      p_org_id: 'org-1',
      p_actor_user_id: 'user-1',
    })
  })

  it('RPCの返り値（フラット行）を PendingApprovalItem に写像する', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          task_id: 't1',
          title: '発注',
          due_date: '2026-07-20',
          due_time: null,
          assignee_hint: '山田',
          group_id: 'g1',
          group_name: 'A社グループ',
          requested_at: '2026-07-15T00:00:00Z',
          approval_notified_at: null,
        },
        {
          task_id: 't2',
          title: '請求',
          due_date: null,
          due_time: null,
          assignee_hint: null,
          group_id: 'g2',
          group_name: 'B社グループ',
          requested_at: '2026-07-15T01:00:00Z',
          approval_notified_at: '2026-07-15T02:00:00Z',
        },
      ],
      error: null,
    })
    const result = await listPendingApprovalsForUser('org-1', 'user-1')
    expect(result[0]).toMatchObject({ taskId: 't1', title: '発注', groupName: 'A社グループ', approvalNotifiedAt: null })
    expect(result[1]).toMatchObject({ taskId: 't2', groupName: 'B社グループ', approvalNotifiedAt: '2026-07-15T02:00:00Z' })
  })

  it('RPCエラーは例外を投げる', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(listPendingApprovalsForUser('org-1', 'user-1')).rejects.toThrow('boom')
  })
})

describe('promoteDigestTask / rejectDigestTask（コンソール経路）', () => {
  it('promote: RPC に task_id と actor を渡し status/created/taskId を返す', async () => {
    rpcMock.mockResolvedValue({ data: [{ status: 'promoted', created: true, task_id: 'new-1' }], error: null })
    const r = await promoteDigestTask('task-1', 'approver-1')
    expect(rpcMock).toHaveBeenCalledWith('rpc_promote_digest_task', {
      p_task_id: 'task-1',
      p_actor_user_id: 'approver-1',
    })
    expect(r).toEqual({ status: 'promoted', created: true, taskId: 'new-1' })
  })

  it('reject: RPC に task_id と actor を渡し status を返す', async () => {
    rpcMock.mockResolvedValue({ data: [{ status: 'rejected' }], error: null })
    const r = await rejectDigestTask('task-1', 'approver-1')
    expect(rpcMock).toHaveBeenCalledWith('rpc_reject_digest_task', {
      p_task_id: 'task-1',
      p_actor_user_id: 'approver-1',
    })
    expect(r).toEqual({ status: 'rejected' })
  })

  it('promote: RPCエラーは例外', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'nope' } })
    await expect(promoteDigestTask('task-1', 'approver-1')).rejects.toThrow('nope')
  })
})
