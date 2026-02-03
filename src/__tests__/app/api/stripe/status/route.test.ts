import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/stripe/status/route'

// Mock the config module
vi.mock('@/lib/stripe/config', () => ({
  getStripeServerConfigStatus: vi.fn(),
}))

import { getStripeServerConfigStatus } from '@/lib/stripe/config'

describe('GET /api/stripe/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return configured: true when all keys are set', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: true,
      hasPublishableKey: true,
      missingKeys: [],
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.configured).toBe(true)
    expect(data.partial).toBe(false)
  })

  it('should return configured: false when keys are missing', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: false,
      hasPublishableKey: false,
      missingKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_PRICE_ID', 'STRIPE_ENTERPRISE_PRICE_ID'],
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.configured).toBe(false)
    expect(data.partial).toBe(false)
  })

  it('should return partial: true when some keys are configured', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: false,
      hasPublishableKey: true,
      missingKeys: ['STRIPE_PRO_PRICE_ID', 'STRIPE_ENTERPRISE_PRICE_ID'],
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.configured).toBe(false)
    expect(data.partial).toBe(true)
  })

  it('should return partial: true when only one key is missing', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: false,
      hasPublishableKey: true,
      missingKeys: ['STRIPE_WEBHOOK_SECRET'],
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.configured).toBe(false)
    expect(data.partial).toBe(true)
  })
})
