import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/admin/shared-bot-access — 共通LINE(共有Bot)の org 単位「開通(grant)」管理API（superadmin専用）。
 *
 * これまで none→requested は org 側 self-service で入るが、requested→granted は
 * service role SQL 手動だった（管理UIなし＝セルフサーブ完走を阻む）。この route が ops の
 * 承認キュー(GET)と付与(POST)を担う。付与者は必ずセッションの superadmin user id を使う。
 */

const verifySuperadminMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: verifySuperadminMock,
}))

const storeMock = {
  listSharedBotAccessRequests: vi.fn(),
  grantSharedBotAccess: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const { GET, POST } = await import('@/app/api/admin/shared-bot-access/route')

const ADMIN_USER_ID = '99999999-9999-4999-8999-999999999999'
const ORG_ID = '11111111-1111-4111-8111-111111111111'

function callPost(body: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/shared-bot-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/shared-bot-access', () => {
  it('non-superadmin は 403', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(403)
    expect(storeMock.listSharedBotAccessRequests).not.toHaveBeenCalled()
  })

  it('superadmin は requested 一覧を返す', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const requests = [
      { orgId: ORG_ID, orgName: 'テスト事務所', requestedAt: '2026-07-21T00:00:00Z', requestedBy: 'u1' },
    ]
    storeMock.listSharedBotAccessRequests.mockResolvedValue(requests)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ requests })
  })
})

describe('POST /api/admin/shared-bot-access', () => {
  it('non-superadmin は 403（付与しない）', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    const res = await callPost({ orgId: ORG_ID })
    expect(res.status).toBe(403)
    expect(storeMock.grantSharedBotAccess).not.toHaveBeenCalled()
  })

  it('orgId 欠落は 400', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPost({})
    expect(res.status).toBe(400)
    expect(storeMock.grantSharedBotAccess).not.toHaveBeenCalled()
  })

  it('superadmin は org を開通し、付与者はセッションの user id', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    storeMock.grantSharedBotAccess.mockResolvedValue('granted')
    const res = await callPost({ orgId: ORG_ID })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ orgId: ORG_ID, sharedBotAccess: 'granted' })
    // 付与者はクライアント申告ではなくセッションの superadmin id
    expect(storeMock.grantSharedBotAccess).toHaveBeenCalledWith(ORG_ID, ADMIN_USER_ID)
  })
})
