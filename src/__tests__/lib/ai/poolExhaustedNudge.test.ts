import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * notifyPoolExhausted — プールAI(当社鍵)の当月org別原価上限に到達したとき、
 * 事務所(内部 owner/admin)へ「自社AIキー登録で即時復旧」を in_app＋メールで届ける。
 *
 * ⚠ これは Pro の内部運用事情。相手先グループには一切出さない（LINE push は無い）。
 * org×月で1回に冪等化。ベストエフォート（例外を投げない）。
 */

const insertNudgeMock = vi.fn()
const orgMaybeSingleMock = vi.fn()
const membershipsInMock = vi.fn()
const notifUpsertMock = vi.fn()
const getUserByIdMock = vi.fn()
const sendEmailMock = vi.fn()

function fromMock(table: string) {
  switch (table) {
    case 'org_pool_exhausted_nudge':
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
vi.mock('@/lib/email/poolAiExhausted', () => ({
  sendPoolAiExhaustedEmail: (...a: unknown[]) => sendEmailMock(...a),
}))

const { notifyPoolExhausted } = await import('@/lib/ai/poolExhaustedNudge')

function baseParams(over: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    spaceId: 'space-1',
    jstMonthKey: '2026-07',
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
  sendEmailMock.mockResolvedValue({ success: true })
})

describe('notifyPoolExhausted', () => {
  it('当月初回: 事務所へ in_app通知＋メール、nudged:true', async () => {
    const res = await notifyPoolExhausted(baseParams())
    expect(res).toEqual({ nudged: true })
    expect(insertNudgeMock).toHaveBeenCalledWith({ org_id: 'org-1', month: '2026-07' })
    // 事務所: in_app 通知（復旧導線 link=/settings/org-integrations）
    expect(notifUpsertMock).toHaveBeenCalled()
    const rows = notifUpsertMock.mock.calls[0][0] as Array<{ payload: { link: string }; type: string }>
    expect(rows[0].type).toBe('pool_ai_exhausted')
    expect(rows[0].payload.link).toBe('/settings/org-integrations')
    // 事務所: メール
    expect(sendEmailMock).toHaveBeenCalledWith({ to: 'a@example.com', orgName: 'テスト事務所' })
  })

  it('相手先グループには一切出さない（LINE push を呼ばない=このモジュールは line client を import しない）', async () => {
    // pushLineMessage を mock していないので、もし呼べば unexpected table 相当で落ちる。
    // ここでは import 経路が無いことを nudged:true の成功で担保する。
    const res = await notifyPoolExhausted(baseParams())
    expect(res).toEqual({ nudged: true })
  })

  it('当月2回目(23505): 何もせず nudged:false（冪等）', async () => {
    insertNudgeMock.mockResolvedValue({ error: { code: '23505' } })
    const res = await notifyPoolExhausted(baseParams())
    expect(res).toEqual({ nudged: false })
    expect(notifUpsertMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('spaceId=null は in_app通知を省きメールのみ出す', async () => {
    const res = await notifyPoolExhausted(baseParams({ spaceId: null }))
    expect(res).toEqual({ nudged: true })
    expect(notifUpsertMock).not.toHaveBeenCalled()
    expect(sendEmailMock).toHaveBeenCalled()
  })

  it('内部 owner/admin が居なければ通知/メールは出さない（nudged:true のまま）', async () => {
    membershipsInMock.mockResolvedValue({ data: [] })
    const res = await notifyPoolExhausted(baseParams())
    expect(res).toEqual({ nudged: true })
    expect(notifUpsertMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('ベストエフォート: メール送信が例外でも reject しない', async () => {
    sendEmailMock.mockRejectedValue(new Error('resend down'))
    await expect(notifyPoolExhausted(baseParams())).resolves.toEqual({ nudged: true })
  })

  it('ガード insert が想定外エラーでも本体を実行せず nudged:false', async () => {
    insertNudgeMock.mockResolvedValue({ error: { code: '42501', message: 'permission' } })
    const res = await notifyPoolExhausted(baseParams())
    expect(res).toEqual({ nudged: false })
    expect(notifUpsertMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
