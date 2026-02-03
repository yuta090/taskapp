import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/stripe/portal/route'
import { NextRequest } from 'next/server'

// Mock Supabase
const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}))

// Mock Stripe
const mockBillingPortalCreate = vi.fn()
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    billingPortal: {
      sessions: {
        create: mockBillingPortalCreate,
      },
    },
  }),
}))

function createRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/stripe/portal', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

describe('POST /api/stripe/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup chain mocks
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle })
  })

  it('should return 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('should return 400 when org_id is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })

    const request = createRequest({})
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Missing org_id')
  })

  it('should return 400 when org_id is invalid UUID', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })

    const request = createRequest({ org_id: 'invalid-uuid' })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid org_id format')
  })

  it('should return 403 when user is not org member', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle.mockResolvedValueOnce({ data: null, error: null })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
  })

  it('should return 403 when user is not owner', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle.mockResolvedValueOnce({ data: { role: 'member' }, error: null })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only organization owners can manage billing')
  })

  it('should return 404 when no stripe customer id exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle
      .mockResolvedValueOnce({ data: { role: 'owner' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error).toBe('No billing information found')
  })

  it('should return portal URL when successful', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle
      .mockResolvedValueOnce({ data: { role: 'owner' }, error: null })
      .mockResolvedValueOnce({ data: { stripe_customer_id: 'cus_123' }, error: null })
    mockBillingPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/xxx' })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.url).toBe('https://billing.stripe.com/session/xxx')
    expect(mockBillingPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'http://localhost:3000/settings/billing',
    })
  })
})
