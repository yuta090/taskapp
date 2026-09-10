import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/stripe/status/route'

// Mock the config module
// 必須キーの一覧は route 側が「一部だけ設定済みか」の判定に使うので、モックにも実物と
// 同じ本数を持たせる（ここを省くと undefined.length で落ちる）
// 設定の配備状況を未ログインに晒さないため、route は認証を要求する
type GetUserResult = { data: { user: { id: string } | null }; error: null }
const getUser = vi.fn<() => Promise<GetUserResult>>(async () => ({
  data: { user: { id: 'u1' } },
  error: null,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}))

vi.mock('@/lib/stripe/config', () => ({
  canCreateCheckout: vi.fn(),
  getStripeServerConfigStatus: vi.fn(),
  isSelfServeCheckoutEnabled: vi.fn(),
  REQUIRED_STRIPE_SERVER_KEYS: [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRO_PRICE_ID',
  ],
}))

import {
  canCreateCheckout,
  getStripeServerConfigStatus,
  isSelfServeCheckoutEnabled,
} from '@/lib/stripe/config'

describe('GET /api/stripe/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 既定は「オンライン申し込みが開いている」状態。閉じている場合は個別のテストで上書きする
    vi.mocked(isSelfServeCheckoutEnabled).mockReturnValue(true)
    // 既定は「進めない」。進める観点のテストだけが明示的に開ける
    vi.mocked(canCreateCheckout).mockReturnValue(false)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  })

  it('should return configured: true when all keys are set', async () => {
    vi.mocked(canCreateCheckout).mockReturnValue(true)
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: true,
      hasPublishableKey: true,
      missingKeys: [],
      missingOptionalKeys: [],
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.canCheckout).toBe(true)
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
    expect(data.canCheckout).toBe(false)
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
    expect(data.canCheckout).toBe(false)
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
    expect(data.canCheckout).toBe(false)
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

  it('鍵は揃っていても元栓が閉じていれば canCheckout=false', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: true,
      hasPublishableKey: true,
      missingKeys: [],
      missingOptionalKeys: [],
    })
    vi.mocked(isSelfServeCheckoutEnabled).mockReturnValue(false)
    vi.mocked(canCreateCheckout).mockReturnValue(false)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

    const data = await (await GET()).json()

    expect(data.canCheckout).toBe(false)
    expect(data.keysConfigured).toBe(true)
    expect(data.selfServeEnabled).toBe(false)
  })

  it('鍵が揃い元栓も開いていれば canCheckout=true', async () => {
    vi.mocked(getStripeServerConfigStatus).mockReturnValue({
      isConfigured: true,
      hasPublishableKey: true,
      missingKeys: [],
      missingOptionalKeys: [],
    })
    vi.mocked(isSelfServeCheckoutEnabled).mockReturnValue(true)
    vi.mocked(canCreateCheckout).mockReturnValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

    const data = await (await GET()).json()

    expect(data.canCheckout).toBe(true)
    expect(data.keysConfigured).toBe(true)
    expect(data.selfServeEnabled).toBe(true)
  })
})

describe('GET /api/stripe/status — 認証', () => {
  it('未ログインには設定の配備状況を返さない', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.keysConfigured).toBeUndefined()
    expect(body.selfServeEnabled).toBeUndefined()
  })
})
