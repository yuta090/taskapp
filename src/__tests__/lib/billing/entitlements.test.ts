import { describe, it, expect, vi } from 'vitest'
import {
  resolvePlanFromBilling,
  planHasFeature,
  resolveOrgEntitlements,
  type OrgBillingRow,
} from '@/lib/billing/entitlements'

const NOW = new Date('2026-07-18T00:00:00+09:00')

function row(overrides: Partial<OrgBillingRow>): OrgBillingRow {
  return {
    plan_id: 'pro',
    status: 'active',
    current_period_end: null,
    cancel_at_period_end: false,
    ...overrides,
  }
}

describe('resolvePlanFromBilling', () => {
  it('(a) null row -> free', () => {
    expect(resolvePlanFromBilling(null, NOW)).toBe('free')
  })

  it('(b) unknown/missing plan_id -> free', () => {
    expect(resolvePlanFromBilling(row({ plan_id: 'mystery-plan', status: 'active' }), NOW)).toBe('free')
    expect(resolvePlanFromBilling(row({ plan_id: null, status: 'active' }), NOW)).toBe('free')
  })

  it('(c) active x pro -> pro', () => {
    expect(resolvePlanFromBilling(row({ plan_id: 'pro', status: 'active' }), NOW)).toBe('pro')
  })

  it('(d) trialing x enterprise -> enterprise', () => {
    expect(resolvePlanFromBilling(row({ plan_id: 'enterprise', status: 'trialing' }), NOW)).toBe('enterprise')
  })

  it('(e) active with cancel_at_period_end=true -> plan is still honored', () => {
    expect(
      resolvePlanFromBilling(
        row({ plan_id: 'pro', status: 'active', cancel_at_period_end: true }),
        NOW
      )
    ).toBe('pro')
  })

  it('(f) past_due within 14 days of period end -> plan maintained', () => {
    // period end 10 days before "now" -> still within the 14-day grace window
    const periodEnd = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)
    expect(
      resolvePlanFromBilling(
        row({ plan_id: 'pro', status: 'past_due', current_period_end: periodEnd.toISOString() }),
        NOW
      )
    ).toBe('pro')
  })

  it('(f-boundary) past_due exactly at the 14-day grace boundary -> plan maintained', () => {
    const periodEnd = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000)
    expect(
      resolvePlanFromBilling(
        row({ plan_id: 'pro', status: 'past_due', current_period_end: periodEnd.toISOString() }),
        NOW
      )
    ).toBe('pro')
  })

  it('(g) past_due beyond 14 days of period end -> free', () => {
    const periodEnd = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000)
    expect(
      resolvePlanFromBilling(
        row({ plan_id: 'pro', status: 'past_due', current_period_end: periodEnd.toISOString() }),
        NOW
      )
    ).toBe('free')
  })

  it('(g-boundary) past_due just over the 14-day grace boundary -> free', () => {
    const periodEnd = new Date(NOW.getTime() - (14 * 24 * 60 * 60 * 1000 + 1000))
    expect(
      resolvePlanFromBilling(
        row({ plan_id: 'pro', status: 'past_due', current_period_end: periodEnd.toISOString() }),
        NOW
      )
    ).toBe('free')
  })

  it('(h) past_due with null current_period_end -> free', () => {
    expect(
      resolvePlanFromBilling(
        row({ plan_id: 'pro', status: 'past_due', current_period_end: null }),
        NOW
      )
    ).toBe('free')
  })

  it('(i) canceled -> free', () => {
    expect(resolvePlanFromBilling(row({ plan_id: 'pro', status: 'canceled' }), NOW)).toBe('free')
  })

  it('(j) unknown status -> free', () => {
    expect(resolvePlanFromBilling(row({ plan_id: 'pro', status: 'unpaid' }), NOW)).toBe('free')
    expect(resolvePlanFromBilling(row({ plan_id: 'pro', status: null }), NOW)).toBe('free')
  })
})

describe('planHasFeature', () => {
  it('free has neither feature', () => {
    expect(planHasFeature('free', 'line_pickup_dual_mode')).toBe(false)
    expect(planHasFeature('free', 'timed_line_reminders')).toBe(false)
  })

  it('pro has both features', () => {
    expect(planHasFeature('pro', 'line_pickup_dual_mode')).toBe(true)
    expect(planHasFeature('pro', 'timed_line_reminders')).toBe(true)
  })

  it('enterprise has both features', () => {
    expect(planHasFeature('enterprise', 'line_pickup_dual_mode')).toBe(true)
    expect(planHasFeature('enterprise', 'timed_line_reminders')).toBe(true)
  })
})

describe('resolveOrgEntitlements', () => {
  function makeAdmin(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn(() => Promise.resolve(result))
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    return { from } as unknown as import('@supabase/supabase-js').SupabaseClient
  }

  it('org_billing row exists (pro, active) -> has(line_pickup_dual_mode) = true', async () => {
    const admin = makeAdmin({
      data: {
        plan_id: 'pro',
        status: 'active',
        current_period_end: null,
        cancel_at_period_end: false,
      },
      error: null,
    })

    const result = await resolveOrgEntitlements(admin, 'org-1', NOW)

    expect(result.planId).toBe('pro')
    expect(result.has('line_pickup_dual_mode')).toBe(true)
    expect(result.has('timed_line_reminders')).toBe(true)
  })

  it('no row -> free / has = false', async () => {
    const admin = makeAdmin({ data: null, error: null })

    const result = await resolveOrgEntitlements(admin, 'org-1', NOW)

    expect(result.planId).toBe('free')
    expect(result.has('line_pickup_dual_mode')).toBe(false)
  })

  it('DB error -> fail-closed to free, does not throw', async () => {
    const admin = makeAdmin({ data: null, error: { message: 'boom' } })

    await expect(resolveOrgEntitlements(admin, 'org-1', NOW)).resolves.toEqual(
      expect.objectContaining({ planId: 'free' })
    )
    const result = await resolveOrgEntitlements(admin, 'org-1', NOW)
    expect(result.has('line_pickup_dual_mode')).toBe(false)
  })
})
