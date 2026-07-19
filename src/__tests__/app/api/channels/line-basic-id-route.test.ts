import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/channels/line/basic-id — 友だち追加QR用の basic_id（公開情報）取得API
 *
 * channel_accounts は資格情報テーブル（RLS上 service_role 専用）。ここは service role で
 * 判定し、credentials/access_token を一切含まない basicId(+ownerType) だけを返す。
 */

const authzMock = { requireInternalMember: vi.fn() }
vi.mock('@/lib/channels/authz', () => authzMock)

const storeMock = { getLineBasicIdWithOwnerTypeForOrg: vi.fn() }
vi.mock('@/lib/channels/store', () => storeMock)

const { GET } = await import('@/app/api/channels/line/basic-id/route')

const ORG = '11111111-1111-4111-8111-111111111111'
const ME = '44444444-4444-4444-8444-444444444444'

function callGet(orgId: string | null) {
  const url = orgId
    ? `http://localhost:3000/api/channels/line/basic-id?orgId=${orgId}`
    : 'http://localhost:3000/api/channels/line/basic-id'
  return GET(new NextRequest(url))
}

beforeEach(() => {
  vi.clearAllMocks()
  authzMock.requireInternalMember.mockResolvedValue({ ok: true, userId: ME, role: 'member' })
  storeMock.getLineBasicIdWithOwnerTypeForOrg.mockResolvedValue({ basicId: '@abc1234', ownerType: 'org' })
})

describe('GET /api/channels/line/basic-id', () => {
  it('orgId欠落は400', async () => {
    const response = await callGet(null)
    expect(response.status).toBe(400)
  })

  it('orgId不正形式は400', async () => {
    const response = await callGet('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('内部メンバーでなければ403', async () => {
    authzMock.requireInternalMember.mockResolvedValue({ ok: false, status: 403, error: 'Internal members only' })
    const response = await callGet(ORG)
    expect(response.status).toBe(403)
    expect(storeMock.getLineBasicIdWithOwnerTypeForOrg).not.toHaveBeenCalled()
  })

  it('未ログインは401', async () => {
    authzMock.requireInternalMember.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const response = await callGet(ORG)
    expect(response.status).toBe(401)
  })

  it('成功: basicId と ownerType を返す', async () => {
    const response = await callGet(ORG)
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toEqual({ basicId: '@abc1234', ownerType: 'org' })
    expect(storeMock.getLineBasicIdWithOwnerTypeForOrg).toHaveBeenCalledWith(ORG)
  })

  it('未プロビジョニング等でbasicIdが無ければ basicId: null, ownerType: null', async () => {
    storeMock.getLineBasicIdWithOwnerTypeForOrg.mockResolvedValue(null)
    const response = await callGet(ORG)
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toEqual({ basicId: null, ownerType: null })
  })

  it('レスポンスに credentials/access_token 等の機微情報を一切含まない', async () => {
    const response = await callGet(ORG)
    const text = JSON.stringify(await response.json())
    expect(text).not.toMatch(/access_token|credentials|channel_secret/i)
  })
})
