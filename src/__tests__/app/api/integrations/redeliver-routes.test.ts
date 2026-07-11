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
  findDeliveryOrgId: vi.fn(),
  redeliverDelivery: vi.fn(),
  findSinkOrgId: vi.fn(),
  redeliverSink: vi.fn(),
}
vi.mock('@/lib/sinks/store', () => sinksStoreMock)

const dispatchBatchMock = vi.fn()
vi.mock('@/lib/sinks/dispatcher', () => ({
  dispatchBatch: (...args: unknown[]) => dispatchBatchMock(...args),
}))

const { POST: redeliverDeliveryPost } = await import(
  '@/app/api/integrations/deliveries/[id]/redeliver/route'
)
const { POST: redeliverSinkPost } = await import('@/app/api/integrations/sinks/[id]/redeliver/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333'
const SINK_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  dispatchBatchMock.mockResolvedValue({ claimed: 0, sent: 0, failed: 0, dead: 0, errors: [] })
})

describe('POST /api/integrations/deliveries/[id]/redeliver', () => {
  function call(id = DELIVERY_ID) {
    const request = new NextRequest(`http://localhost:3000/api/integrations/deliveries/${id}/redeliver`, {
      method: 'POST',
    })
    return redeliverDeliveryPost(request, { params: Promise.resolve({ id }) })
  }

  it('404 when the delivery does not exist', async () => {
    sinksStoreMock.findDeliveryOrgId.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(404)
  })

  it('403 for members (owner/admin only)', async () => {
    sinksStoreMock.findDeliveryOrgId.mockResolvedValue(ORG_ID)
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await call()
    expect(response.status).toBe(403)
  })

  it('409 when the delivery is not dead/failed', async () => {
    sinksStoreMock.findDeliveryOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.redeliverDelivery.mockResolvedValue(false)
    const response = await call()
    expect(response.status).toBe(409)
    expect(dispatchBatchMock).not.toHaveBeenCalled()
  })

  it('200 requeues and triggers a best-effort immediate dispatch', async () => {
    sinksStoreMock.findDeliveryOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.redeliverDelivery.mockResolvedValue(true)
    const response = await call()
    expect(response.status).toBe(200)
    expect(dispatchBatchMock).toHaveBeenCalled()
  })

  it('does not fail the request if the best-effort dispatch throws', async () => {
    sinksStoreMock.findDeliveryOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.redeliverDelivery.mockResolvedValue(true)
    dispatchBatchMock.mockRejectedValue(new Error('cron busy'))
    const response = await call()
    expect(response.status).toBe(200)
  })
})

describe('POST /api/integrations/sinks/[id]/redeliver', () => {
  function call(id = SINK_ID) {
    const request = new NextRequest(`http://localhost:3000/api/integrations/sinks/${id}/redeliver`, {
      method: 'POST',
    })
    return redeliverSinkPost(request, { params: Promise.resolve({ id }) })
  }

  it('404 when the sink does not exist', async () => {
    sinksStoreMock.findSinkOrgId.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(404)
  })

  it('403 for members (owner/admin only)', async () => {
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await call()
    expect(response.status).toBe(403)
  })

  it('200 with the requeued count; skips dispatch when nothing was requeued', async () => {
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.redeliverSink.mockResolvedValue(0)
    const response = await call()
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({ ok: true, count: 0 })
    expect(dispatchBatchMock).not.toHaveBeenCalled()
  })

  it('triggers a best-effort immediate dispatch when deliveries were requeued', async () => {
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.redeliverSink.mockResolvedValue(5)
    const response = await call()
    const data = await response.json()
    expect(data.count).toBe(5)
    expect(dispatchBatchMock).toHaveBeenCalled()
  })
})
