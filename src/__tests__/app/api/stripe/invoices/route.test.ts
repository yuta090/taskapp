import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/stripe/invoices/route'
import { NextRequest } from 'next/server'

// Mock Supabase
const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}))

// Mock Stripe config
vi.mock('@/lib/stripe/config', () => ({
  getStripeServerConfigStatus: vi.fn(() => ({
    isConfigured: true,
    missingKeys: [],
  })),
}))

// Mock Stripe
const mockInvoicesList = vi.fn()
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    invoices: {
      list: mockInvoicesList,
    },
  }),
}))

function createRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/stripe/invoices')
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
  }
  return new NextRequest(url, { method: 'GET' })
}

describe('GET /api/stripe/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup chain mocks
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, order: mockOrder, single: mockSingle })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockLimit.mockReturnValue({ single: mockSingle })
  })

  it('should return 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const request = createRequest()
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('should return empty array when no org membership', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle.mockResolvedValue({ data: null, error: null })

    const request = createRequest()
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invoices).toEqual([])
  })

  it('should return 400 when org_id format is invalid', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })

    const request = createRequest({ org_id: 'invalid-uuid' })
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid org_id format')
  })

  it('should return 403 when user is not org member', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle.mockResolvedValue({ data: null, error: null })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Not a member of this organization')
  })

  it('should return empty array when no stripe customer', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle
      .mockResolvedValueOnce({ data: { role: 'owner' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invoices).toEqual([])
  })

  it('should return invoices when successful', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle
      .mockResolvedValueOnce({ data: { role: 'owner' }, error: null })
      .mockResolvedValueOnce({ data: { stripe_customer_id: 'cus_123' }, error: null })

    const mockStripeInvoices = {
      data: [
        {
          id: 'inv_123',
          number: 'INV-0001',
          amount_due: 1000,
          amount_paid: 1000,
          currency: 'jpy',
          status: 'paid',
          created: 1704067200,
          invoice_pdf: 'https://example.com/pdf',
          hosted_invoice_url: 'https://example.com/invoice',
        },
      ],
    }
    mockInvoicesList.mockResolvedValue(mockStripeInvoices)

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invoices).toHaveLength(1)
    expect(data.invoices[0].id).toBe('inv_123')
    expect(data.invoices[0].number).toBe('INV-0001')
    expect(mockInvoicesList).toHaveBeenCalledWith({
      customer: 'cus_123',
      limit: 24,
    })
  })

  it('should use primary org when org_id not provided', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle
      .mockResolvedValueOnce({ data: { org_id: '123e4567-e89b-12d3-a456-426614174000' }, error: null })
      .mockResolvedValueOnce({ data: { role: 'owner' }, error: null })
      .mockResolvedValueOnce({ data: { stripe_customer_id: 'cus_123' }, error: null })

    mockInvoicesList.mockResolvedValue({ data: [] })

    const request = createRequest()
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invoices).toEqual([])
  })

  it('should return 403 when user is not owner', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockSingle.mockResolvedValue({ data: { role: 'member' }, error: null })

    const request = createRequest({ org_id: '123e4567-e89b-12d3-a456-426614174000' })
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only organization owners can view billing information')
  })
})
