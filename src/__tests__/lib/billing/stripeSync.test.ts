import { describe, it, expect } from 'vitest'
import {
  mapStripeSubscriptionStatus,
  resolvePlanIdFromPriceId,
  buildBillingPatchFromSubscription,
  billingPatchDiffers,
  deletedSubscriptionPatch,
} from '@/lib/billing/stripeSync'

const PRICE_MAP = { pro: 'price_pro', enterprise: 'price_ent' }

describe('mapStripeSubscriptionStatus', () => {
  it('既知ステータスは webhook と同一に写像する', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('active')
    expect(mapStripeSubscriptionStatus('trialing')).toBe('trialing')
    expect(mapStripeSubscriptionStatus('past_due')).toBe('past_due')
    expect(mapStripeSubscriptionStatus('canceled')).toBe('canceled')
    expect(mapStripeSubscriptionStatus('unpaid')).toBe('canceled')
  })

  it('未知ステータスの既定は active（webhook 挙動を保持）', () => {
    expect(mapStripeSubscriptionStatus('incomplete')).toBe('active')
    expect(mapStripeSubscriptionStatus('paused')).toBe('active')
  })

  it('reconcile 用に未知を canceled へ倒せる（over-entitlement を防ぐ fail-safe）', () => {
    expect(mapStripeSubscriptionStatus('incomplete', { unknownFallback: 'canceled' })).toBe('canceled')
    // 既知ステータスは fallback を無視して従来通り
    expect(mapStripeSubscriptionStatus('active', { unknownFallback: 'canceled' })).toBe('active')
  })
})

describe('resolvePlanIdFromPriceId', () => {
  it('price id を plan へ写像する', () => {
    expect(resolvePlanIdFromPriceId('price_pro', PRICE_MAP)).toBe('pro')
    expect(resolvePlanIdFromPriceId('price_ent', PRICE_MAP)).toBe('enterprise')
  })
  it('未知/nullは undefined（plan_idを変更しない）', () => {
    expect(resolvePlanIdFromPriceId('price_other', PRICE_MAP)).toBeUndefined()
    expect(resolvePlanIdFromPriceId(null, PRICE_MAP)).toBeUndefined()
    expect(resolvePlanIdFromPriceId('price_pro', { pro: null, enterprise: null })).toBeUndefined()
  })
})

describe('buildBillingPatchFromSubscription', () => {
  it('active な pro サブスクを patch 化する', () => {
    const patch = buildBillingPatchFromSubscription(
      {
        status: 'active',
        current_period_end: 1893456000, // 2030-01-01 頃
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_pro' } }] },
      },
      { priceMap: PRICE_MAP, unknownFallback: 'canceled' },
    )
    expect(patch.plan_id).toBe('pro')
    expect(patch.status).toBe('active')
    expect(patch.current_period_end).toBe(new Date(1893456000 * 1000).toISOString())
    expect(patch.cancel_at_period_end).toBe(false)
  })

  it('canceled は status=canceled（有効プランは resolve 側で free になる）', () => {
    const patch = buildBillingPatchFromSubscription(
      { status: 'canceled', current_period_end: null, cancel_at_period_end: false, items: { data: [] } },
      { priceMap: PRICE_MAP, unknownFallback: 'canceled' },
    )
    expect(patch.status).toBe('canceled')
    expect(patch.current_period_end).toBeNull()
  })

  it('price 未解決時は metadata.plan_id にフォールバックする', () => {
    const patch = buildBillingPatchFromSubscription(
      {
        status: 'active',
        items: { data: [{ price: { id: 'price_unknown' } }] },
        metadata: { plan_id: 'enterprise' },
      },
      { priceMap: PRICE_MAP, unknownFallback: 'canceled' },
    )
    expect(patch.plan_id).toBe('enterprise')
  })

  it('price も metadata も無ければ plan_id を含めない（既存維持）', () => {
    const patch = buildBillingPatchFromSubscription(
      { status: 'active', items: { data: [] } },
      { priceMap: PRICE_MAP, unknownFallback: 'canceled' },
    )
    expect('plan_id' in patch).toBe(false)
  })

  it('未知ステータスは fail-safe で canceled へ（reconcile）', () => {
    const patch = buildBillingPatchFromSubscription(
      { status: 'incomplete', items: { data: [{ price: { id: 'price_pro' } }] } },
      { priceMap: PRICE_MAP, unknownFallback: 'canceled' },
    )
    expect(patch.status).toBe('canceled')
  })
})

describe('billingPatchDiffers', () => {
  const current = {
    plan_id: 'pro' as const,
    status: 'active' as const,
    current_period_end: '2030-01-01T00:00:00.000Z',
    cancel_at_period_end: false,
  }

  it('同一なら false（無駄な書き込みを避ける）', () => {
    expect(billingPatchDiffers(current, { ...current })).toBe(false)
  })
  it('status 差分を検出', () => {
    expect(billingPatchDiffers(current, { ...current, status: 'canceled' })).toBe(true)
  })
  it('plan_id 差分を検出', () => {
    expect(billingPatchDiffers(current, { ...current, plan_id: 'enterprise' })).toBe(true)
  })
  it('patch に plan_id が無ければ plan_id は比較しない', () => {
    const p = { status: 'active' as const, current_period_end: current.current_period_end, cancel_at_period_end: false }
    expect(billingPatchDiffers(current, p)).toBe(false)
  })
})

describe('deletedSubscriptionPatch', () => {
  it('Stripe側で消えたサブスクは free/active に戻す（webhook deleted と同じ）', () => {
    const p = deletedSubscriptionPatch()
    expect(p.plan_id).toBe('free')
    expect(p.status).toBe('active')
    expect(p.current_period_end).toBeNull()
    expect(p.cancel_at_period_end).toBe(false)
  })
})
