import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * createInstantDigestTask（Stage 2.5 §2 / 2.7-B §4-5: メンション即時タスク化）
 *
 * グループ行を FOR UPDATE でロックする RPC(rpc_create_instant_digest_task) 経由で INSERT する。
 * 承認者(approver)・space_id・extracted_date(JST) は *ロックした行* から DB 側で確定するため、
 * アプリは org/space/approver を渡さない（取得〜作成の隙間の承認者変更レースを DB 側で直列化）。
 * pending 判定は RPC の返す is_pending をそのまま返す。
 * unique(source_message_id, title) 競合は is_duplicate=true の冪等成功。
 */

let response: { data: unknown; error: unknown }
const rpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    rpc: (...args: unknown[]) => {
      rpcMock(...args)
      return { single: () => Promise.resolve(response) }
    },
  })),
}))

const { createInstantDigestTask } = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  response = { data: { id: 'task-9', is_pending: false, is_duplicate: false }, error: null }
})

describe('createInstantDigestTask', () => {
  it('rpc_create_instant_digest_task を group と候補内容だけで呼ぶ（org/space/approverは渡さない）', async () => {
    const result = await createInstantDigestTask({
      groupId: 'group-1',
      sourceMessageId: 'msg-1',
      title: '見積提出',
      assigneeHint: '@山田',
      dueDate: '2026-07-20',
      dueTime: '10:00',
    })

    expect(result).toEqual({ id: 'task-9', pending: false, duplicate: false })
    expect(rpcMock).toHaveBeenCalledWith('rpc_create_instant_digest_task', {
      p_group_id: 'group-1',
      p_source_message_id: 'msg-1',
      p_title: '見積提出',
      p_assignee_hint: '@山田',
      p_assignee_external_user_id: null,
      p_assignee_identity_id: null,
      p_due_date: '2026-07-20',
      p_due_time: '10:00',
    })
    // アプリ側が org/space/approver を渡していないことを保証（DB がロック行から確定する）
    const arg = rpcMock.mock.calls[0][1] as Record<string, unknown>
    expect(arg).not.toHaveProperty('p_org_id')
    expect(arg).not.toHaveProperty('p_space_id')
    expect(arg).not.toHaveProperty('p_approver_user_id')
  })

  it('省略可能な項目は null で渡す', async () => {
    await createInstantDigestTask({
      groupId: 'group-1',
      sourceMessageId: 'msg-2',
      title: '在庫確認',
    })
    expect(rpcMock).toHaveBeenCalledWith('rpc_create_instant_digest_task', {
      p_group_id: 'group-1',
      p_source_message_id: 'msg-2',
      p_title: '在庫確認',
      p_assignee_hint: null,
      p_assignee_external_user_id: null,
      p_assignee_identity_id: null,
      p_due_date: null,
      p_due_time: null,
    })
  })

  it('RPCが is_pending=true を返せば承認フロー扱いにする', async () => {
    response = { data: { id: 'task-9', is_pending: true, is_duplicate: false }, error: null }
    const result = await createInstantDigestTask({
      groupId: 'group-1',
      sourceMessageId: 'msg-3',
      title: '酒屋へ発注',
    })
    expect(result).toEqual({ id: 'task-9', pending: true, duplicate: false })
  })

  it('unique(source_message_id, title)競合は is_duplicate=true・id=null の冪等成功で返す', async () => {
    response = { data: { id: null, is_pending: true, is_duplicate: true }, error: null }
    const result = await createInstantDigestTask({
      groupId: 'group-1',
      sourceMessageId: 'msg-1',
      title: '見積提出',
    })
    expect(result).toEqual({ id: null, pending: true, duplicate: true })
  })

  it('DBエラーは例外を投げる', async () => {
    response = { data: null, error: { message: 'boom' } }
    await expect(
      createInstantDigestTask({ groupId: 'group-1', sourceMessageId: 'msg-1', title: '見積提出' }),
    ).rejects.toThrow('boom')
  })
})
