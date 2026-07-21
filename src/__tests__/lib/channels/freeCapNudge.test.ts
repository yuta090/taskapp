import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * nudgeFreeCapReached — 無料50到達時のアップグレード促し。
 * 出し分け: 事務所=アプリ内通知＋メール（本命）/ 相手先グループ=中立の1行（営業文言なし・月1回）。
 * org×月で1回に冪等化。ベストエフォート（例外を投げない）。
 */

const insertNudgeMock = vi.fn()
const orgMaybeSingleMock = vi.fn()
const membershipsInMock = vi.fn()
const notifUpsertMock = vi.fn()
const getUserByIdMock = vi.fn()
const pushLineMock = vi.fn()
const sendEmailMock = vi.fn()

function fromMock(table: string) {
  switch (table) {
    case 'org_free_cap_nudge':
      return { insert: insertNudgeMock }
    case 'organizations':
      return { select: () => ({ eq: () => ({ maybeSingle: orgMaybeSingleMock }) }) }
    case 'org_memberships':
      return { select: () => ({ eq: () => ({ in: membershipsInMock }) }) }
    case 'notifications':
      return { upsert: notifUpsertMock }
    default:
      throw new Error(`unexpected table ${table}`)
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: fromMock, auth: { admin: { getUserById: getUserByIdMock } } }),
}))
vi.mock('@/lib/channels/line/client', () => ({
  pushLineMessage: (...a: unknown[]) => pushLineMock(...a),
}))
vi.mock('@/lib/email/freeCapUpgrade', () => ({
  sendFreeCapUpgradeEmail: (...a: unknown[]) => sendEmailMock(...a),
}))

const { nudgeFreeCapReached, FREE_CAP_GROUP_NOTICE } = await import('@/lib/channels/freeCapNudge')

function baseParams(over: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    spaceId: 'space-1',
    account: { id: 'acc-1', ownerType: 'platform' as const, accessToken: 'tok' },
    groupExternalId: 'G1',
    jstMonthKey: '2026-07',
    globalBudgetHard: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  insertNudgeMock.mockResolvedValue({ error: null })
  orgMaybeSingleMock.mockResolvedValue({ data: { name: 'テスト事務所' } })
  membershipsInMock.mockResolvedValue({ data: [{ user_id: 'u1' }] })
  notifUpsertMock.mockResolvedValue({ error: null })
  getUserByIdMock.mockResolvedValue({ data: { user: { email: 'a@example.com' } } })
  pushLineMock.mockResolvedValue(undefined)
  sendEmailMock.mockResolvedValue({ success: true })
})

describe('中立文言の安全性', () => {
  it('グループ中立1行に「無料/上限/アップグレード/Pro」等の気まずい語を含めない', () => {
    for (const w of ['無料', '上限', 'アップグレード', 'Pro', '有料', 'プラン']) {
      expect(FREE_CAP_GROUP_NOTICE).not.toContain(w)
    }
  })
})

describe('nudgeFreeCapReached', () => {
  it('当月初回: 事務所へ通知＋メール、グループへ中立1行、nudged:true', async () => {
    const res = await nudgeFreeCapReached(baseParams())
    expect(res).toEqual({ nudged: true })
    expect(insertNudgeMock).toHaveBeenCalledWith({ org_id: 'org-1', month: '2026-07' })
    // 事務所: in_app 通知（アップグレード導線 link=/settings/billing）
    expect(notifUpsertMock).toHaveBeenCalled()
    const rows = notifUpsertMock.mock.calls[0][0] as Array<{ payload: { link: string }; type: string }>
    expect(rows[0].type).toBe('free_cap_upgrade')
    expect(rows[0].payload.link).toBe('/settings/billing')
    // 事務所: メール
    expect(sendEmailMock).toHaveBeenCalledWith({ to: 'a@example.com', orgName: 'テスト事務所' })
    // 相手先グループ: 中立1行
    expect(pushLineMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'G1', messages: [{ type: 'text', text: FREE_CAP_GROUP_NOTICE }] }),
    )
  })

  it('当月2回目(23505): 何もせず nudged:false（冪等）', async () => {
    insertNudgeMock.mockResolvedValue({ error: { code: '23505' } })
    const res = await nudgeFreeCapReached(baseParams())
    expect(res).toEqual({ nudged: false })
    expect(notifUpsertMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(pushLineMock).not.toHaveBeenCalled()
  })

  it('グローバル予算 hard のときはグループ中立1行を送らない（事務所通知は出す）', async () => {
    const res = await nudgeFreeCapReached(baseParams({ globalBudgetHard: true }))
    expect(res).toEqual({ nudged: true })
    expect(sendEmailMock).toHaveBeenCalled()
    expect(pushLineMock).not.toHaveBeenCalled()
  })

  it('spaceId=null は in_app通知を省きメール＋グループ中立1行は出す', async () => {
    const res = await nudgeFreeCapReached(baseParams({ spaceId: null }))
    expect(res).toEqual({ nudged: true })
    expect(notifUpsertMock).not.toHaveBeenCalled()
    expect(sendEmailMock).toHaveBeenCalled()
    expect(pushLineMock).toHaveBeenCalled()
  })

  it('内部 owner/admin が居なければ通知/メールは出さない（グループ中立1行は出す）', async () => {
    membershipsInMock.mockResolvedValue({ data: [] })
    const res = await nudgeFreeCapReached(baseParams())
    expect(res).toEqual({ nudged: true })
    expect(notifUpsertMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(pushLineMock).toHaveBeenCalled()
  })

  it('ベストエフォート: メール送信が例外でも reject しない', async () => {
    sendEmailMock.mockRejectedValue(new Error('resend down'))
    await expect(nudgeFreeCapReached(baseParams())).resolves.toEqual({ nudged: true })
  })

  it('ベストエフォート: グループ push が例外でも reject しない', async () => {
    pushLineMock.mockRejectedValue(new Error('line 429'))
    await expect(nudgeFreeCapReached(baseParams())).resolves.toEqual({ nudged: true })
  })

  it('ガード insert が想定外エラーでも本体を実行せず nudged:false', async () => {
    insertNudgeMock.mockResolvedValue({ error: { code: '42501', message: 'permission' } })
    const res = await nudgeFreeCapReached(baseParams())
    expect(res).toEqual({ nudged: false })
    expect(pushLineMock).not.toHaveBeenCalled()
  })
})
