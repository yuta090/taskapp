import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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

const sinksStoreMock = {
  findSinkOrgId: vi.fn(),
  findDeliverableSink: vi.fn(),
  insertPingDelivery: vi.fn(),
}
vi.mock('@/lib/sinks/store', () => sinksStoreMock)

const dispatchClaimedDeliveryMock = vi.fn()
vi.mock('@/lib/sinks/dispatcher', () => ({
  dispatchClaimedDelivery: (...args: unknown[]) => dispatchClaimedDeliveryMock(...args),
}))

const testNotionConnectionMock = vi.fn()
vi.mock('@/lib/sinks/adapters/notion', () => ({
  testNotionConnection: (...args: unknown[]) => testNotionConnectionMock(...args),
}))

const { POST } = await import('@/app/api/integrations/sinks/[id]/test/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const SINK_ID = '22222222-2222-4222-8222-222222222222'

function callPost(id = SINK_ID) {
  const request = new NextRequest(`http://localhost:3000/api/integrations/sinks/${id}/test`, { method: 'POST' })
  return POST(request, { params: Promise.resolve({ id }) })
}

describe('POST /api/integrations/sinks/[id]/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.findDeliverableSink.mockResolvedValue({ id: SINK_ID, provider: 'webhook', config: {}, secret: 's' })
    sinksStoreMock.insertPingDelivery.mockResolvedValue({ id: 'delivery-1', eventType: 'ping' })
    dispatchClaimedDeliveryMock.mockResolvedValue('sent')
  })

  it('404 when the sink does not exist', async () => {
    sinksStoreMock.findSinkOrgId.mockResolvedValue(null)
    const response = await callPost()
    expect(response.status).toBe(404)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPost()
    expect(response.status).toBe(403)
  })

  it('400 when the sink is not deliverable (e.g. unsupported provider)', async () => {
    sinksStoreMock.findDeliverableSink.mockResolvedValue(null)
    const response = await callPost()
    expect(response.status).toBe(400)
    expect(sinksStoreMock.insertPingDelivery).not.toHaveBeenCalled()
  })

  it('inserts a ping delivery and dispatches it synchronously', async () => {
    const response = await callPost()
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({ deliveryId: 'delivery-1', outcome: 'sent' })
    expect(dispatchClaimedDeliveryMock).toHaveBeenCalledWith(
      { id: 'delivery-1', eventType: 'ping' },
      { id: SINK_ID, provider: 'webhook', config: {}, secret: 's' },
    )
  })

  // レビュー指摘(Minor): webhookはoutcomeが'sent'|'failed'|'dead'の文字列。notionも
  // 同じ形状に揃え(成功→'sent'/失敗→'failed')、error/responseStatusは併記フィールドにする。
  it('notion sinks are verified via a database query instead of a ping delivery (no page is created); success maps to outcome:"sent"', async () => {
    const NOTION_SINK = { id: SINK_ID, provider: 'notion' as const, accessToken: 'tok', databaseId: 'db-1' }
    sinksStoreMock.findDeliverableSink.mockResolvedValue(NOTION_SINK)
    testNotionConnectionMock.mockResolvedValue({ ok: true, responseStatus: 200 })

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ deliveryId: null, outcome: 'sent', responseStatus: 200 })
    expect(testNotionConnectionMock).toHaveBeenCalledWith(NOTION_SINK)
    expect(sinksStoreMock.insertPingDelivery).not.toHaveBeenCalled()
    expect(dispatchClaimedDeliveryMock).not.toHaveBeenCalled()
  })

  it('notion failures map to outcome:"failed" with the adapter error text attached', async () => {
    const NOTION_SINK = { id: SINK_ID, provider: 'notion' as const, accessToken: 'tok', databaseId: 'db-1' }
    sinksStoreMock.findDeliverableSink.mockResolvedValue(NOTION_SINK)
    testNotionConnectionMock.mockResolvedValue({ ok: false, responseStatus: 401, error: 'unauthorized' })

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ deliveryId: null, outcome: 'failed', responseStatus: 401, error: 'unauthorized' })
  })
})
