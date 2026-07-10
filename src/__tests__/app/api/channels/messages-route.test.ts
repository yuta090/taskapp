import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/messages — WoZ期の秘書名義送信（送信UI用）
 *
 * - 認証: セッション必須 + org内部メンバー(owner/admin/member)のみ
 * - 対象spaceのactive identityが無ければ409（未突合）
 * - orgのLINEアカウントが無ければ409
 * - 送信は 記録(queued) → push → sent/failed 更新。証跡が先、送信が後
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

const storeMock = {
  findActiveIdentityForSpace: vi.fn(),
  findLineAccountForOrg: vi.fn(),
  insertChannelMessage: vi.fn(),
  updateChannelMessageStatus: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const pushMock = vi.fn()
vi.mock('@/lib/channels/line/client', () => ({
  pushLineMessage: (...args: unknown[]) => pushMock(...args),
  LinePushError: class LinePushError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'LinePushError'
      this.status = status
    }
  },
}))

const { POST } = await import('@/app/api/channels/messages/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/channels/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const validBody = {
  orgId: '11111111-1111-4111-8111-111111111111',
  spaceId: '22222222-2222-4222-8222-222222222222',
  text: '今月の請求書をお送りください。',
}

describe('POST /api/channels/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.findActiveIdentityForSpace.mockResolvedValue({ id: 'ident-1', externalId: 'U-c1' })
    storeMock.findLineAccountForOrg.mockResolvedValue({
      id: 'acc-1',
      orgId: validBody.orgId,
      displayName: '山田会計事務所',
      channelSecret: 's',
      accessToken: 'token-1',
    })
    storeMock.insertChannelMessage.mockResolvedValue({ id: 'row-1' })
    pushMock.mockResolvedValue(undefined)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPost(validBody)
    expect(response.status).toBe(401)
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('内部メンバーでない(client等)は403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await callPost(validBody)
    expect(response.status).toBe(403)
  })

  it('text欠落は400', async () => {
    const response = await callPost({ ...validBody, text: '' })
    expect(response.status).toBe(400)
  })

  it('active identityが無ければ409（未突合）', async () => {
    storeMock.findActiveIdentityForSpace.mockResolvedValue(null)
    const response = await callPost(validBody)
    expect(response.status).toBe(409)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('orgにLINEアカウントが無ければ409', async () => {
    storeMock.findLineAccountForOrg.mockResolvedValue(null)
    const response = await callPost(validBody)
    expect(response.status).toBe(409)
  })

  it('成功: queued記録 → push(retryKey=行id) → sent更新', async () => {
    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'outbound',
        actor: 'secretary',
        sentBy: 'staff-1',
        status: 'queued',
        spaceId: validBody.spaceId,
        identityId: 'ident-1',
        body: validBody.text,
      }),
    )
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'U-c1', retryKey: 'row-1' }),
    )
    expect(storeMock.updateChannelMessageStatus).toHaveBeenCalledWith('row-1', 'sent', undefined)
  })

  it('push失敗: failed更新して502', async () => {
    pushMock.mockRejectedValue(new Error('LINE push failed (500)'))
    const response = await callPost(validBody)

    expect(response.status).toBe(502)
    expect(storeMock.updateChannelMessageStatus).toHaveBeenCalledWith(
      'row-1',
      'failed',
      expect.stringContaining('LINE push failed'),
    )
  })
})
