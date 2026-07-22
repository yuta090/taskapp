import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * notifySharedBotAccessRequested — 共通LINE(共有Bot)の利用申込が入ったことを
 * 運営(superadmin)全員へメールで知らせる。
 *
 * ⚠ これが無いと「申し込んだのに誰も気づかない」＝開通が止まり顧客を失う
 *   （申込APIは DB 状態を変えるだけで通知が一切なかった。2026-07-22 是正）。
 * 宛先は profiles.is_superadmin = true の全員（管理者は複数登録できる）。
 * ベストエフォート: 例外を投げない（通知の失敗で申込API自体を落とさない）。
 */

const superadminSelectMock = vi.fn()
const orgMaybeSingleMock = vi.fn()
const getUserByIdMock = vi.fn()
const sendEmailMock = vi.fn()

function fromMock(table: string) {
  switch (table) {
    case 'profiles':
      return { select: () => ({ eq: superadminSelectMock }) }
    case 'organizations':
      return { select: () => ({ eq: () => ({ maybeSingle: orgMaybeSingleMock }) }) }
    default:
      throw new Error(`unexpected table ${table}`)
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: fromMock, auth: { admin: { getUserById: getUserByIdMock } } }),
}))
vi.mock('@/lib/email/sharedBotAccessRequested', () => ({
  sendSharedBotAccessRequestedEmail: (...a: unknown[]) => sendEmailMock(...a),
}))

const { notifySharedBotAccessRequested } = await import('@/lib/channels/sharedBotRequestNotify')

beforeEach(() => {
  vi.clearAllMocks()
  superadminSelectMock.mockResolvedValue({ data: [{ id: 'admin-1' }, { id: 'admin-2' }] })
  orgMaybeSingleMock.mockResolvedValue({ data: { name: 'テスト事務所' } })
  getUserByIdMock.mockImplementation(async (id: string) => ({
    data: { user: { email: `${id}@example.com` } },
  }))
  sendEmailMock.mockResolvedValue({ success: true })
})

describe('notifySharedBotAccessRequested', () => {
  it('superadmin 全員へメールを送る（管理者は複数登録できる）', async () => {
    const res = await notifySharedBotAccessRequested({ orgId: 'org-1' })
    expect(res).toEqual({ notified: 2 })
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin-1@example.com', orgName: 'テスト事務所' }),
    )
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin-2@example.com', orgName: 'テスト事務所' }),
    )
  })

  it('承認画面への導線を必ず渡す（受け取った人がすぐ開通できる）', async () => {
    await notifySharedBotAccessRequested({ orgId: 'org-1' })
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1' }),
    )
  })

  it('superadmin が居なければ何も送らない（例外にしない）', async () => {
    superadminSelectMock.mockResolvedValue({ data: [] })
    const res = await notifySharedBotAccessRequested({ orgId: 'org-1' })
    expect(res).toEqual({ notified: 0 })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('メールアドレスが無い管理者はスキップする', async () => {
    getUserByIdMock.mockImplementation(async (id: string) =>
      id === 'admin-1' ? { data: { user: { email: null } } } : { data: { user: { email: 'a2@example.com' } } },
    )
    const res = await notifySharedBotAccessRequested({ orgId: 'org-1' })
    expect(res).toEqual({ notified: 1 })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('org 名が引けなくても送る（宛先を失わない）', async () => {
    orgMaybeSingleMock.mockResolvedValue({ data: null })
    const res = await notifySharedBotAccessRequested({ orgId: 'org-1' })
    expect(res.notified).toBe(2)
  })

  it('ベストエフォート: メール送信が例外でも reject しない', async () => {
    sendEmailMock.mockRejectedValue(new Error('resend down'))
    await expect(notifySharedBotAccessRequested({ orgId: 'org-1' })).resolves.toEqual({ notified: 0 })
  })

  it('ベストエフォート: superadmin 取得が失敗しても reject しない', async () => {
    superadminSelectMock.mockRejectedValue(new Error('db down'))
    await expect(notifySharedBotAccessRequested({ orgId: 'org-1' })).resolves.toEqual({ notified: 0 })
  })
})
