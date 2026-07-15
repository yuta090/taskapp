import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * claimApprovalNotification / clearApprovalNotifiedAt（Stage 2.7-B §4-5）
 *
 * 即時1:1送信のための単票 claim ラッパと、送信失敗時の未通知戻し。
 * 認可・二重送信防止のロジックは RPC(SQL) 側にあり、ここでは薄いラッパの契約のみ検証する。
 */

const rpcMock = vi.fn()
const updateEqMock = vi.fn()
const updateMock = vi.fn(() => ({ eq: updateEqMock }))
const fromMock = vi.fn(() => ({ update: updateMock }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: rpcMock, from: fromMock })),
}))

const { claimApprovalNotification, clearApprovalNotifiedAt } = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  updateEqMock.mockResolvedValue({ error: null })
})

describe('claimApprovalNotification', () => {
  it('rpc_claim_approval_notification に task_id を渡し、返った external_user_id を返す', async () => {
    rpcMock.mockResolvedValue({ data: 'U-approver', error: null })
    const result = await claimApprovalNotification('task-1')
    expect(rpcMock).toHaveBeenCalledWith('rpc_claim_approval_notification', { p_task_id: 'task-1' })
    expect(result).toBe('U-approver')
  })

  it('送れない（権限なし/リンクなし/非pending）場合は null', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    expect(await claimApprovalNotification('task-1')).toBeNull()
  })

  it('RPCエラーは例外を投げる（webhook側で握って候補は残す）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(claimApprovalNotification('task-1')).rejects.toThrow('boom')
  })
})

describe('clearApprovalNotifiedAt', () => {
  it('approval_notified_at を null に戻す（当該 task のみ）', async () => {
    await clearApprovalNotifiedAt('task-1')
    expect(fromMock).toHaveBeenCalledWith('channel_digest_tasks')
    expect(updateMock).toHaveBeenCalledWith({ approval_notified_at: null })
    expect(updateEqMock).toHaveBeenCalledWith('id', 'task-1')
  })

  it('DBエラーは例外を投げる', async () => {
    updateEqMock.mockResolvedValue({ error: { message: 'nope' } })
    await expect(clearApprovalNotifiedAt('task-1')).rejects.toThrow('nope')
  })
})
