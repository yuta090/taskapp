import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getStripeClientConfigStatus, getStripeServerConfigStatus } from '@/lib/stripe/config'

describe('getStripeClientConfigStatus', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should return configured when publishable key is set', () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_xxx'

    const status = getStripeClientConfigStatus()

    expect(status.isConfigured).toBe(true)
    expect(status.hasPublishableKey).toBe(true)
    expect(status.missingKeys).toEqual([])
  })

  it('should return not configured when publishable key is missing', () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

    const status = getStripeClientConfigStatus()

    expect(status.isConfigured).toBe(false)
    expect(status.hasPublishableKey).toBe(false)
    expect(status.missingKeys).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
  })
})

describe('getStripeServerConfigStatus', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should return configured when all keys are set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro'
    process.env.STRIPE_ENTERPRISE_PRICE_ID = 'price_enterprise'

    const status = getStripeServerConfigStatus()

    expect(status.isConfigured).toBe(true)
    expect(status.missingKeys).toEqual([])
  })

  it('should return not configured when secret key is missing', () => {
    delete process.env.STRIPE_SECRET_KEY
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro'
    process.env.STRIPE_ENTERPRISE_PRICE_ID = 'price_enterprise'

    const status = getStripeServerConfigStatus()

    expect(status.isConfigured).toBe(false)
    expect(status.missingKeys).toContain('STRIPE_SECRET_KEY')
  })

  it('should return not configured when webhook secret is missing', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'
    delete process.env.STRIPE_WEBHOOK_SECRET
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro'
    process.env.STRIPE_ENTERPRISE_PRICE_ID = 'price_enterprise'

    const status = getStripeServerConfigStatus()

    expect(status.isConfigured).toBe(false)
    expect(status.missingKeys).toContain('STRIPE_WEBHOOK_SECRET')
  })

  it('should return not configured when price IDs are missing', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'
    delete process.env.STRIPE_PRO_PRICE_ID
    delete process.env.STRIPE_ENTERPRISE_PRICE_ID

    const status = getStripeServerConfigStatus()

    expect(status.isConfigured).toBe(false)
    expect(status.missingKeys).toContain('STRIPE_PRO_PRICE_ID')
    expect(status.missingKeys).toContain('STRIPE_ENTERPRISE_PRICE_ID')
  })

  it('should list all missing keys', () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_PRO_PRICE_ID
    delete process.env.STRIPE_ENTERPRISE_PRICE_ID

    const status = getStripeServerConfigStatus()

    expect(status.isConfigured).toBe(false)
    expect(status.missingKeys).toHaveLength(4)
  })
})
