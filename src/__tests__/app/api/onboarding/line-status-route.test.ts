import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/onboarding/line-status
 *
 * DM到達不能「安全網」の可視化: 既存の lineAccountReady/lineAccess/hasLineLinked/aiConfigured
 * に加え、対象ユーザー自身のDMが到達不能(channel_user_links.dm_unreachable_at 非NULL)かを
 * dmUnreachable として返す。オンボーディング(SetupChecklist)がこの1回のfetchに相乗りする
 * ため、新規fetchは増やさない。
 */

const requireInternalMemberMock = vi.fn()
const hasActiveUserLinkForUserMock = vi.fn()
const getLineSelfServeStateMock = vi.fn()
const isDmUnreachableForUserMock = vi.fn()
const getAiConfigStatusMock = vi.fn()

vi.mock('@/lib/channels/authz', () => ({
  requireInternalMember: (...a: unknown[]) => requireInternalMemberMock(...a),
}))
vi.mock('@/lib/channels/store', () => ({
  hasActiveUserLinkForUser: (...a: unknown[]) => hasActiveUserLinkForUserMock(...a),
  getLineSelfServeState: (...a: unknown[]) => getLineSelfServeStateMock(...a),
  isDmUnreachableForUser: (...a: unknown[]) => isDmUnreachableForUserMock(...a),
}))
vi.mock('@/lib/ai/client', () => ({
  getAiConfigStatus: (...a: unknown[]) => getAiConfigStatusMock(...a),
}))

const { GET } = await import('@/app/api/onboarding/line-status/route')

const ORG = '11111111-1111-4111-8111-111111111111'

function callGet(orgId: string = ORG) {
  return GET(
    new NextRequest(new URL(`/api/onboarding/line-status?orgId=${orgId}`, 'http://localhost:3000')),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  requireInternalMemberMock.mockResolvedValue({ ok: true, userId: 'user-1' })
  hasActiveUserLinkForUserMock.mockResolvedValue(true)
  getLineSelfServeStateMock.mockResolvedValue('granted')
  isDmUnreachableForUserMock.mockResolvedValue(false)
  getAiConfigStatusMock.mockResolvedValue({ configured: true })
})

describe('GET /api/onboarding/line-status', () => {
  it('dmUnreachable:false（未マーク）をレスポンスに含める', async () => {
    const res = await callGet()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dmUnreachable).toBe(false)
    expect(json.hasLineLinked).toBe(true)
    expect(json.lineAccess).toBe('granted')
  })

  it('DM到達不能マーク済みなら dmUnreachable:true を返す', async () => {
    isDmUnreachableForUserMock.mockResolvedValue(true)
    const res = await callGet()
    const json = await res.json()
    expect(json.dmUnreachable).toBe(true)
  })

  it('isDmUnreachableForUser を org/user 両方で呼ぶ', async () => {
    await callGet()
    expect(isDmUnreachableForUserMock).toHaveBeenCalledWith(ORG, 'user-1')
  })

  it('内部メンバーでなければ拒否する', async () => {
    requireInternalMemberMock.mockResolvedValue({ ok: false, error: 'forbidden', status: 403 })
    const res = await callGet()
    expect(res.status).toBe(403)
    expect(isDmUnreachableForUserMock).not.toHaveBeenCalled()
  })

  it('orgIdが不正なら400', async () => {
    const res = await callGet('not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('内部エラーは500かつ dmUnreachable フィールドを含まない失敗応答', async () => {
    isDmUnreachableForUserMock.mockRejectedValue(new Error('db down'))
    const res = await callGet()
    expect(res.status).toBe(500)
  })
})
