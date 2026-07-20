import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/group-claims/approval — 共有botグループ紐付けの承認/却下（Stage 4・PR3a）
 *
 * promoteのdigest承認 (/api/channels/digest-tasks/approval) とは別route・別命名。
 * こちらは channel_group_claims / rpc_approve_group_claim / rpc_reject_group_claim を扱う。
 * 承認者user_idは必ずセッション(auth.getUser)から解決し、クライアント申告は受けない。
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

type Reason = 'not_found' | 'forbidden' | 'conflict' | 'invalid' | 'limit'
class GroupClaimActionError extends Error {
  reason: Reason
  constructor(message: string, reason: Reason) {
    super(message)
    this.reason = reason
  }
}

const storeMock = {
  findGroupClaimOrgAndChannel: vi.fn(),
  approveGroupClaim: vi.fn(),
  rejectGroupClaim: vi.fn(),
  orgLineGroupCapacity: vi.fn(),
  orgExternalChatGroupCapacity: vi.fn(),
  orgHasExternalChatChannels: vi.fn(),
  GroupClaimActionError,
}
vi.mock('@/lib/channels/store', () => storeMock)

const { POST } = await import('@/app/api/channels/group-claims/approval/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'

function callPost(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/group-claims/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/channels/group-claims/approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'approver-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue({ orgId: ORG_ID, channel: 'line' })
    storeMock.approveGroupClaim.mockResolvedValue(true)
    storeMock.rejectGroupClaim.mockResolvedValue(true)
    storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 0, maxGroups: null }) // 既定=無制限
    storeMock.orgExternalChatGroupCapacity.mockResolvedValue({ activeCount: 0, max: null })
    storeMock.orgHasExternalChatChannels.mockResolvedValue(true)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(403)
  })

  it('不正なactionは400', async () => {
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'bogus' })
    expect(res.status).toBe(400)
  })

  it('orgId/claimId欠落は400', async () => {
    const res = await callPost({ orgId: ORG_ID, action: 'approve' })
    expect(res.status).toBe(400)
  })

  it('他orgのclaimIdは404（RPCを呼ばない）', async () => {
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue({ orgId: 'org-OTHER', channel: 'line' })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(404)
    expect(storeMock.approveGroupClaim).not.toHaveBeenCalled()
  })

  it('claim未存在(null)も404', async () => {
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue(null)
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(404)
  })

  it('approve: 成功(true) → 200 でセッションのuserIdをapproverに渡す（上限は解決した値を渡す）', async () => {
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(200)
    // 既定は maxGroups=null（無制限）なので null を渡す
    expect(storeMock.approveGroupClaim).toHaveBeenCalledWith(CLAIM_ID, 'approver-1', null)
    expect(storeMock.rejectGroupClaim).not.toHaveBeenCalled()
  })

  it('approve(line): 解決した maxLineGroups を approveGroupClaim へ渡す（RPCのアトミック強制用）', async () => {
    storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 2, maxGroups: 3 })
    await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(storeMock.approveGroupClaim).toHaveBeenCalledWith(CLAIM_ID, 'approver-1', 3)
  })

  it('approve(discord): 解決した maxExternalChatGroups を approveGroupClaim へ渡す', async () => {
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue({ orgId: ORG_ID, channel: 'discord' })
    storeMock.orgExternalChatGroupCapacity.mockResolvedValue({ activeCount: 10, max: 50 })
    await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(storeMock.approveGroupClaim).toHaveBeenCalledWith(CLAIM_ID, 'approver-1', 50)
  })

  it('approve: 容量上限のレース(GroupClaimActionError limit) → 402', async () => {
    storeMock.approveGroupClaim.mockRejectedValue(new GroupClaimActionError('capacity reached', 'limit'))
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(402)
  })

  it('approve: graceful reject(false・同時承認の敗者) → 409', async () => {
    storeMock.approveGroupClaim.mockResolvedValue(false)
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(409)
  })

  it('approve: グループ上限到達 → 402（承認せず・既存は切らない）', async () => {
    storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 3, maxGroups: 3 })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json.code).toBe('group_limit_reached')
    expect(storeMock.approveGroupClaim).not.toHaveBeenCalled()
  })

  it('approve: 上限未満なら通常承認（402にしない）', async () => {
    storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 2, maxGroups: 3 })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(200)
    expect(storeMock.approveGroupClaim).toHaveBeenCalled()
  })

  it('approve(line): LINE経路は外部チャット容量/エンタイトルメントを参照しない', async () => {
    await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(storeMock.orgLineGroupCapacity).toHaveBeenCalledWith(ORG_ID)
    expect(storeMock.orgExternalChatGroupCapacity).not.toHaveBeenCalled()
    expect(storeMock.orgHasExternalChatChannels).not.toHaveBeenCalled()
  })

  it('approve(discord): 非LINEは external_chat_channels＋maxExternalChatGroups で判定（LINE容量は見ない）', async () => {
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue({ orgId: ORG_ID, channel: 'discord' })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(200)
    expect(storeMock.orgHasExternalChatChannels).toHaveBeenCalledWith(ORG_ID)
    expect(storeMock.orgExternalChatGroupCapacity).toHaveBeenCalledWith(ORG_ID, 'discord')
    expect(storeMock.orgLineGroupCapacity).not.toHaveBeenCalled()
    // 既定は max=null（無制限）なので null を渡す
    expect(storeMock.approveGroupClaim).toHaveBeenCalledWith(CLAIM_ID, 'approver-1', null)
  })

  it('approve(discord): external_chat_channels 非所持は 402（承認せず）', async () => {
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue({ orgId: ORG_ID, channel: 'discord' })
    storeMock.orgHasExternalChatChannels.mockResolvedValue(false)
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json.code).toBe('external_chat_not_entitled')
    expect(storeMock.approveGroupClaim).not.toHaveBeenCalled()
  })

  it('approve(discord): 上限到達(maxExternalChatGroups)は 402（承認せず・既存は切らない）', async () => {
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue({ orgId: ORG_ID, channel: 'discord' })
    storeMock.orgExternalChatGroupCapacity.mockResolvedValue({ activeCount: 50, max: 50 })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json.code).toBe('group_limit_reached')
    expect(storeMock.approveGroupClaim).not.toHaveBeenCalled()
  })

  it('approve(discord): enterprise(max=null)は上限で弾かれない', async () => {
    storeMock.findGroupClaimOrgAndChannel.mockResolvedValue({ orgId: ORG_ID, channel: 'discord' })
    storeMock.orgExternalChatGroupCapacity.mockResolvedValue({ activeCount: 999, max: null })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(200)
    expect(storeMock.approveGroupClaim).toHaveBeenCalled()
  })

  it('reject は上限チェックをしない（既存の却下は常に可能）', async () => {
    storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 9, maxGroups: 3 })
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'reject' })
    expect(res.status).toBe(200)
    expect(storeMock.rejectGroupClaim).toHaveBeenCalled()
  })

  it('approve: GroupClaimActionError(not_found) → 404', async () => {
    storeMock.approveGroupClaim.mockRejectedValue(new GroupClaimActionError('unknown claim_id', 'not_found'))
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(404)
  })

  it('approve: GroupClaimActionError(forbidden) → 403', async () => {
    storeMock.approveGroupClaim.mockRejectedValue(new GroupClaimActionError('not a member', 'forbidden'))
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(403)
  })

  it('approve: GroupClaimActionError(conflict・非pending/消費済み) → 409', async () => {
    storeMock.approveGroupClaim.mockRejectedValue(new GroupClaimActionError('already consumed', 'conflict'))
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(409)
  })

  it('approve: GroupClaimActionError(invalid・期限切れ/失効/purpose不一致等) → 422', async () => {
    storeMock.approveGroupClaim.mockRejectedValue(new GroupClaimActionError('expired', 'invalid'))
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(422)
  })

  it('approve: 未分類の例外は500', async () => {
    storeMock.approveGroupClaim.mockRejectedValue(new Error('unexpected'))
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'approve' })
    expect(res.status).toBe(500)
  })

  it('reject: 成功(true) → 200 でセッションのuserIdをapproverに渡す', async () => {
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'reject' })
    expect(res.status).toBe(200)
    expect(storeMock.rejectGroupClaim).toHaveBeenCalledWith(CLAIM_ID, 'approver-1')
    expect(storeMock.approveGroupClaim).not.toHaveBeenCalled()
  })

  it('reject: 既に処理済み(false) → 409', async () => {
    storeMock.rejectGroupClaim.mockResolvedValue(false)
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'reject' })
    expect(res.status).toBe(409)
  })

  it('reject: GroupClaimActionError(not_found) → 404', async () => {
    storeMock.rejectGroupClaim.mockRejectedValue(new GroupClaimActionError('unknown claim_id', 'not_found'))
    const res = await callPost({ orgId: ORG_ID, claimId: CLAIM_ID, action: 'reject' })
    expect(res.status).toBe(404)
  })
})
