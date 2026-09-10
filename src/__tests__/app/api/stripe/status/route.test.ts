import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/stripe/status/route'

// Mock the config module
// 必須キーの一覧は route 側が「一部だけ設定済みか」の判定に使うので、モックにも実物と
// 同じ本数を持たせる（ここを省くと undefined.length で落ちる）
vi.mock('@/lib/stripe/config', () => ({
  getStripeServerConfigStatus: vi.fn(),
  isSelfServeCheckoutEnabled: vi.fn(),
  REQUIRED_STRIPE_SERVER_KEYS: [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRO_PRICE_ID',
  ],
}))

import { getStripeServerConfigStatus, isSelfServeCheckoutEnabled } from '@/lib/stripe/config'

describe('GET /api/stripe/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 既定は「オンライン申し込みが開いている」状態。閉じている場合は個別のテストで上書きする
    vi.mocked(isSelfServeCheckoutEnabled).mockReturnValue(true)
  })

  it('should return configured: true when all keys are set', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: true,
      hasPublishableKey: true,
      missingKeys: [],
      missingOptionalKeys: [],
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
      missingKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_PRICE_ID'],
      missingOptionalKeys: ['STRIPE_ENTERPRISE_PRICE_ID'],
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
      missingKeys: ['STRIPE_PRO_PRICE_ID'],
      missingOptionalKeys: ['STRIPE_ENTERPRISE_PRICE_ID'],
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
      missingOptionalKeys: [],
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.configured).toBe(false)
    expect(data.partial).toBe(true)
  })
})

/**
 * 鍵が揃っていても、オンライン申し込みの元栓が閉じているあいだは決済導線を開かない。
 * （Stripe 側の本番切替・商品と価格の準備が終わる前にお客様を決済画面へ進ませないため）
 */
describe('GET /api/stripe/status — オンライン申し込みの元栓', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('鍵は揃っていても元栓が閉じていれば configured=false', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: true,
      hasPublishableKey: true,
      missingKeys: [],
      missingOptionalKeys: [],
    })
    vi.mocked(isSelfServeCheckoutEnabled).mockReturnValue(false)

    const data = await (await GET()).json()

    expect(data.configured).toBe(false)
    expect(data.keysConfigured).toBe(true)
    expect(data.selfServeEnabled).toBe(false)
  })

  it('鍵が揃い元栓も開いていれば configured=true', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: true,
      hasPublishableKey: true,
      missingKeys: [],
      missingOptionalKeys: [],
    })
    vi.mocked(isSelfServeCheckoutEnabled).mockReturnValue(true)

    const data = await (await GET()).json()

    expect(data.configured).toBe(true)
    expect(data.keysConfigured).toBe(true)
    expect(data.selfServeEnabled).toBe(true)
  })
})
