import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/onboarding/shared-bot-access/request — 共通LINEの利用申込。
 * 新規申込(none→requested に遷移)のときだけ運営へ通知する契約を固定する。
 * 再申込の連打で運営のメールを溢れさせないため。
 */

const requestSharedBotAccessMock = vi.fn()
const notifyMock = vi.fn()
const requireInternalMemberMock = vi.fn()

vi.mock('@/lib/channels/store', () => ({
  requestSharedBotAccess: (...a: unknown[]) => requestSharedBotAccessMock(...a),
}))
vi.mock('@/lib/channels/sharedBotRequestNotify', () => ({
  notifySharedBotAccessRequested: (...a: unknown[]) => notifyMock(...a),
}))
vi.mock('@/lib/channels/authz', () => ({
  requireInternalMember: (...a: unknown[]) => requireInternalMemberMock(...a),
}))

const { POST } = await import('@/app/api/onboarding/shared-bot-access/request/route')

const ORG = '11111111-1111-4111-8111-111111111111'

function callPost(orgId: string = ORG) {
  return POST(
    new NextRequest(new URL('/api/onboarding/shared-bot-access/request', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  requireInternalMemberMock.mockResolvedValue({ ok: true, userId: 'user-1' })
  requestSharedBotAccessMock.mockResolvedValue({ access: 'requested', transitioned: true })
  notifyMock.mockResolvedValue({ notified: 2 })
})

describe('POST /api/onboarding/shared-bot-access/request', () => {
  it('新規申込(transitioned)なら運営へ通知する', async () => {
    const res = await callPost()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ access: 'requested' })
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock).toHaveBeenCalledWith({ orgId: ORG })
  })

  it('再申込(transitioned=false)では通知しない（連打でメールを溢れさせない）', async () => {
    requestSharedBotAccessMock.mockResolvedValue({ access: 'requested', transitioned: false })
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('既に開通済み(granted)なら通知しない', async () => {
    requestSharedBotAccessMock.mockResolvedValue({ access: 'granted', transitioned: false })
    const res = await callPost()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ access: 'granted' })
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('通知が失敗しても申込は成功として返す（記録はもう確定している）', async () => {
    notifyMock.mockRejectedValue(new Error('resend down'))
    const res = await callPost()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ access: 'requested' })
  })

  it('内部メンバーでなければ拒否し、通知もしない', async () => {
    requireInternalMemberMock.mockResolvedValue({ ok: false, error: 'forbidden', status: 403 })
    const res = await callPost()
    expect(res.status).toBe(403)
    expect(requestSharedBotAccessMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('orgId が不正なら 400', async () => {
    const res = await callPost('not-a-uuid')
    expect(res.status).toBe(400)
    expect(notifyMock).not.toHaveBeenCalled()
  })
})
