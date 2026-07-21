import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * getAiConfig の鍵解決分岐（fable裁定 2026-07-21 プールAI鍵）。
 * 解決順: enabled=false→disabled / BYO成立→byo / BYO不成立×entitled→pooled(cap内) / それ以外→missing。
 * fail-closed（Freeはプールに到達しない）と cap 執行・fail-open を固定する。
 */

const fromMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const resolveOrgEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: resolveOrgEntitlementsMock,
}))

const getOrgPooledCostJpyThisMonthMock = vi.fn()
vi.mock('@/lib/ai/usage', () => ({
  recordAiUsage: vi.fn(),
  getOrgPooledCostJpyThisMonth: getOrgPooledCostJpyThisMonthMock,
}))

const ai = await import('@/lib/ai/client')
const { AiConfigError } = await import('@/lib/ai/errors')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orgAiConfigChain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.select = vi.fn(() => b)
  b.eq = vi.fn(() => b)
  b.maybeSingle = vi.fn(() => Promise.resolve(response))
  return b
}

function entitled(v: boolean) {
  return { planId: v ? 'pro' : 'free', has: (f: string) => v && f === 'pooled_ai_key' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let orgAiConfigResponse: any

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PLATFORM_AI_API_KEY', 'sk-pool')
  vi.stubEnv('PLATFORM_AI_PROVIDER', 'openai')
  vi.stubEnv('PLATFORM_AI_MODEL', 'gpt-4o-mini')
  vi.stubEnv('PLATFORM_AI_MONTHLY_CAP_JPY_PER_ORG', '1000')
  rpcMock.mockResolvedValue({ data: 'decrypted-key', error: null })
  orgAiConfigResponse = { data: null, error: null }
  fromMock.mockImplementation(() => orgAiConfigChain(orgAiConfigResponse))
})
afterEach(() => vi.unstubAllEnvs())

describe('getAiConfig — BYO', () => {
  it('BYO成立(enabled・鍵あり・valid)は自前鍵を復号して source=byo（プール判定に入らない）', async () => {
    orgAiConfigResponse = {
      data: { provider: 'anthropic', model: 'claude-haiku-4-5', api_key_encrypted: 'enc', enabled: true, key_status: 'valid' },
      error: null,
    }
    const cfg = await ai.getAiConfig('org-1')
    expect(cfg).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'decrypted-key', source: 'byo' })
    expect(resolveOrgEntitlementsMock).not.toHaveBeenCalled()
  })

  it('enabled=false は entitled でも disabled（プールに落とさない・opt-out尊重）', async () => {
    orgAiConfigResponse = { data: { enabled: false, api_key_encrypted: 'enc' }, error: null }
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(true))
    await expect(ai.getAiConfig('org-1')).rejects.toMatchObject({ kind: 'disabled' })
    expect(resolveOrgEntitlementsMock).not.toHaveBeenCalled()
  })
})

describe('getAiConfig — プール', () => {
  it('BYO未設定×entitled×cap内 → source=pooled（env鍵）', async () => {
    orgAiConfigResponse = { data: null, error: null }
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(true))
    getOrgPooledCostJpyThisMonthMock.mockResolvedValue(0)
    const cfg = await ai.getAiConfig('org-1')
    expect(cfg).toEqual({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-pool', source: 'pooled' })
  })

  it('key_status=invalid×entitled はプールへフォールバック（壊れた鍵で止めない）', async () => {
    orgAiConfigResponse = {
      data: { provider: 'openai', model: 'gpt-4o', api_key_encrypted: 'enc', enabled: true, key_status: 'invalid' },
      error: null,
    }
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(true))
    getOrgPooledCostJpyThisMonthMock.mockResolvedValue(0)
    const cfg = await ai.getAiConfig('org-1')
    expect(cfg.source).toBe('pooled')
  })

  it('当月pooled原価が上限以上 → pool_quota_exhausted', async () => {
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(true))
    getOrgPooledCostJpyThisMonthMock.mockResolvedValue(1000) // cap=1000 → 到達
    await expect(ai.getAiConfig('org-1')).rejects.toMatchObject({ kind: 'pool_quota_exhausted' })
  })

  it('cap照会が例外でも fail-open（プール継続・全Pro抽出を止めない）', async () => {
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(true))
    getOrgPooledCostJpyThisMonthMock.mockRejectedValue(new Error('telemetry db down'))
    const cfg = await ai.getAiConfig('org-1')
    expect(cfg.source).toBe('pooled')
  })

  it('cap未設定なら cap照会せずプール継続', async () => {
    vi.stubEnv('PLATFORM_AI_MONTHLY_CAP_JPY_PER_ORG', '')
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(true))
    const cfg = await ai.getAiConfig('org-1')
    expect(cfg.source).toBe('pooled')
    expect(getOrgPooledCostJpyThisMonthMock).not.toHaveBeenCalled()
  })
})

describe('getAiConfig — fail-closed', () => {
  it('BYO未設定×not entitled(Free) → missing（プールに到達しない）', async () => {
    orgAiConfigResponse = { data: null, error: null }
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(false))
    await expect(ai.getAiConfig('org-1')).rejects.toMatchObject({ kind: 'missing' })
    expect(getOrgPooledCostJpyThisMonthMock).not.toHaveBeenCalled()
  })

  it('PLATFORM_AI_API_KEY 未設定なら entitled でも missing（kill switch・entitlement照会もしない）', async () => {
    vi.stubEnv('PLATFORM_AI_API_KEY', '')
    orgAiConfigResponse = { data: null, error: null }
    resolveOrgEntitlementsMock.mockResolvedValue(entitled(true))
    await expect(ai.getAiConfig('org-1')).rejects.toMatchObject({ kind: 'missing' })
    expect(resolveOrgEntitlementsMock).not.toHaveBeenCalled()
  })
})
