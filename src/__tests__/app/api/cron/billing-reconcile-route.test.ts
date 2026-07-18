import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/billing-reconcile — webhook 欠落是正の backstop
 *
 * - Bearer CRON_SECRET 必須
 * - 非free×サブスク紐付き行を Stripe ライブ状態で照合し、差分があれば更新
 * - resource_missing（削除済み）→ free に戻す / 一時障害 → スキップ（誤 downgrade しない）
 */

const storeMock = {
  listReconcilableBillingRows: vi.fn(),
  applyBillingReconcile: vi.fn(),
}
vi.mock('@/lib/billing/billingReconcileStore', () => storeMock)

const retrieveMock = vi.fn()
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ subscriptions: { retrieve: (...a: unknown[]) => retrieveMock(...a) } }),
}))

const { POST } = await import('@/app/api/cron/billing-reconcile/route')

function callPost(opts: { auth?: boolean; dryRun?: boolean } = {}) {
  const auth: Record<string, string> =
    opts.auth === false ? {} : { authorization: 'Bearer test-cron-secret' }
  const suffix = opts.dryRun ? '?dryRun=true' : ''
  const request = new NextRequest(
    new URL(`/api/cron/billing-reconcile${suffix}`, 'http://localhost:3000'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({}),
    },
  )
  return POST(request)
}

const PRO_ROW = {
  orgId: 'org-1',
  planId: 'pro',
  status: 'active',
  currentPeriodEnd: '2030-01-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  stripeSubscriptionId: 'sub_1',
}

describe('POST /api/cron/billing-reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro'
    process.env.STRIPE_ENTERPRISE_PRICE_ID = 'price_ent'
    storeMock.listReconcilableBillingRows.mockResolvedValue([PRO_ROW])
    storeMock.applyBillingReconcile.mockResolvedValue(undefined)
  })

  it('CRON_SECRET が無ければ 401', async () => {
    const res = await callPost({ auth: false })
    expect(res.status).toBe(401)
    expect(retrieveMock).not.toHaveBeenCalled()
  })

  it('Stripe が canceled を返す（webhook欠落）→ org_billing を canceled に更新', async () => {
    retrieveMock.mockResolvedValue({
      status: 'canceled',
      current_period_end: null,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro' } }] },
    })
    const res = await callPost()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.updated).toBe(1)
    expect(storeMock.applyBillingReconcile).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ status: 'canceled' }),
      { expectedSubscriptionId: 'sub_1' },
    )
  })

  it('Stripe が active のまま（差分なし）→ 書き込まない', async () => {
    retrieveMock.mockResolvedValue({
      status: 'active',
      current_period_end: Math.floor(new Date('2030-01-01T00:00:00.000Z').getTime() / 1000),
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro' } }] },
    })
    const res = await callPost()
    const json = await res.json()
    expect(json.updated).toBe(0)
    expect(storeMock.applyBillingReconcile).not.toHaveBeenCalled()
  })

  it('resource_missing（削除済み）→ free に戻し subscription_id を消す', async () => {
    retrieveMock.mockRejectedValue({ code: 'resource_missing' })
    const res = await callPost()
    const json = await res.json()
    expect(json.updated).toBe(1)
    expect(storeMock.applyBillingReconcile).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ plan_id: 'free', status: 'active' }),
      { clearSubscriptionId: true, expectedSubscriptionId: 'sub_1' },
    )
  })

  it('一時障害（resource_missing以外）→ スキップし書き込まない（誤downgrade防止）', async () => {
    retrieveMock.mockRejectedValue(new Error('Stripe 503'))
    const res = await callPost()
    const json = await res.json()
    expect(json.updated).toBe(0)
    expect(json.skipped).toHaveLength(1)
    expect(json.skipped[0].orgId).toBe('org-1')
    expect(storeMock.applyBillingReconcile).not.toHaveBeenCalled()
  })

  it('dryRun は照合するが書き込まない', async () => {
    retrieveMock.mockResolvedValue({
      status: 'canceled',
      items: { data: [{ price: { id: 'price_pro' } }] },
    })
    const res = await callPost({ dryRun: true })
    const json = await res.json()
    expect(json.dryRun).toBe(true)
    expect(json.updated).toBe(1)
    expect(json.changes).toHaveLength(1)
    expect(storeMock.applyBillingReconcile).not.toHaveBeenCalled()
  })

  it('resource_missing が多数かつ高割合 → サーキットブレーカで一括ダウングレードを止める', async () => {
    // 6 org すべてが Stripe 側で「消えている」ように見える（鍵取り違え/mode不一致など運用事故を模す）
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...PRO_ROW,
      orgId: `org-${i}`,
      stripeSubscriptionId: `sub_${i}`,
    }))
    storeMock.listReconcilableBillingRows.mockResolvedValue(rows)
    retrieveMock.mockRejectedValue({ code: 'resource_missing' })

    const res = await callPost()
    const json = await res.json()

    expect(json.circuitBreaker).toBe('resource_missing')
    expect(json.missing).toBe(6)
    expect(json.updated).toBe(0)
    expect(json.skipped).toHaveLength(6)
    // 破壊的な free ダウングレードは一切書き込まない
    expect(storeMock.applyBillingReconcile).not.toHaveBeenCalled()
  })

  it('resource_missing が少数（閾値未満）なら通常どおり free に戻す', async () => {
    // 1件だけ消滅（小規模アカウントの正当な解約）→ ブレーカ発火せず適用
    retrieveMock.mockRejectedValue({ code: 'resource_missing' })
    const res = await callPost()
    const json = await res.json()
    expect(json.circuitBreaker).toBeUndefined()
    expect(json.updated).toBe(1)
    expect(storeMock.applyBillingReconcile).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ plan_id: 'free', status: 'active' }),
      { clearSubscriptionId: true, expectedSubscriptionId: 'sub_1' },
    )
  })
})
