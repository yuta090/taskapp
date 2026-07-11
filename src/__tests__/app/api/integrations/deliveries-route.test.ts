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

const sinksStoreMock = { listDeliveries: vi.fn() }
vi.mock('@/lib/sinks/store', () => sinksStoreMock)

const { GET } = await import('@/app/api/integrations/deliveries/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const SINK_ID = '22222222-2222-4222-8222-222222222222'
const TASK_ID = '33333333-3333-4333-8333-333333333333'

function call(query: string) {
  const request = new NextRequest(`http://localhost:3000/api/integrations/deliveries?${query}`)
  return GET(request)
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
  sinksStoreMock.listDeliveries.mockResolvedValue([])
})

describe('GET /api/integrations/deliveries', () => {
  it('400 for a missing/invalid orgId', async () => {
    const response = await call('sinkId=' + SINK_ID)
    expect(response.status).toBe(400)
  })

  it('403 for non-internal members', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await call('orgId=' + ORG_ID)
    expect(response.status).toBe(403)
  })

  it('400 for an invalid sinkId', async () => {
    const response = await call(`orgId=${ORG_ID}&sinkId=not-a-uuid`)
    expect(response.status).toBe(400)
  })

  it('passes through sinkId/taskId/before/limit filters', async () => {
    const response = await call(
      `orgId=${ORG_ID}&sinkId=${SINK_ID}&taskId=${TASK_ID}&before=2026-07-10T00:00:00.000Z&limit=10`,
    )
    expect(response.status).toBe(200)
    expect(sinksStoreMock.listDeliveries).toHaveBeenCalledWith({
      orgId: ORG_ID,
      sinkId: SINK_ID,
      taskId: TASK_ID,
      beforeCreatedAt: '2026-07-10T00:00:00.000Z',
      limit: 10,
    })
  })

  it('caps the limit at 200', async () => {
    await call(`orgId=${ORG_ID}&limit=99999`)
    expect(sinksStoreMock.listDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    )
  })

  it('defaults limit to 50 when not provided', async () => {
    await call(`orgId=${ORG_ID}`)
    expect(sinksStoreMock.listDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    )
  })
})
