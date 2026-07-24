import { describe, it, expect, vi } from 'vitest'
import {
  resolvePlanFromBilling,
  planHasFeature,
  planLimits,
  resolveOrgEntitlements,
  resolveOrgLimits,
  PLAN_LIMITS,
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
  it('free は自動タスク拾いは持つが、時刻リマインドは持たない', () => {
    expect(planHasFeature('free', 'line_pickup_dual_mode')).toBe(true)
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

  it('Pro中核（白ラベル/1:1DM/即時）は pro・enterprise のみ、free には無い', () => {
    for (const f of ['own_line_account', 'line_direct_dm', 'instant_line_notify'] as const) {
      expect(planHasFeature('free', f)).toBe(false)
      expect(planHasFeature('pro', f)).toBe(true)
      expect(planHasFeature('enterprise', f)).toBe(true)
    }
  })

  it('外部チャット連携(external_chat_channels)は Pro専有（LINE以外の他チャット＝Proの売り）', () => {
    expect(planHasFeature('free', 'external_chat_channels')).toBe(false)
    expect(planHasFeature('pro', 'external_chat_channels')).toBe(true)
    expect(planHasFeature('enterprise', 'external_chat_channels')).toBe(true)
  })

  it('自動タスク拾いは free に開放・ただし即時通知は Pro のみ（Free=日次まとめで差別化）', () => {
    expect(planHasFeature('free', 'line_pickup_dual_mode')).toBe(true)
    expect(planHasFeature('free', 'instant_line_notify')).toBe(false)
    expect(planHasFeature('pro', 'instant_line_notify')).toBe(true)
  })
})

describe('planLimits', () => {
  it('free は狭い上限（グループ3・共通LINE送信50・外部チャットは0=Pro専有）', () => {
    expect(planLimits('free')).toEqual({
      maxLineGroups: 3,
      monthlySharedPushQuota: 50,
      maxExternalChatGroups: 0,
    })
  })
  it('pro はグループ枠あり・共通LINE送信は無制限（自社LINEは原価が顧客側）', () => {
    expect(planLimits('pro').maxLineGroups).toBe(50)
    expect(planLimits('pro').monthlySharedPushQuota).toBeNull()
    // 外部チャット（Discord等）の紐付け上限（安全側の仮値）
    expect(planLimits('pro').maxExternalChatGroups).toBe(50)
  })
  it('enterprise は無制限', () => {
    expect(planLimits('enterprise')).toEqual({
      maxLineGroups: null,
      monthlySharedPushQuota: null,
      maxExternalChatGroups: null,
    })
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

  it('no row -> free（拾いは持つが Pro専有機能は持たない）', async () => {
    const admin = makeAdmin({ data: null, error: null })

    const result = await resolveOrgEntitlements(admin, 'org-1', NOW)

    expect(result.planId).toBe('free')
    expect(result.has('line_pickup_dual_mode')).toBe(true)
    expect(result.has('instant_line_notify')).toBe(false)
    expect(result.has('timed_line_reminders')).toBe(false)
  })

  it('DB error -> fail-closed to free, does not throw', async () => {
    const admin = makeAdmin({ data: null, error: { message: 'boom' } })

    await expect(resolveOrgEntitlements(admin, 'org-1', NOW)).resolves.toEqual(
      expect.objectContaining({ planId: 'free' })
    )
    const result = await resolveOrgEntitlements(admin, 'org-1', NOW)
    // fail-closed = free。Pro専有機能は持たない（拾いは free でも持つ）
    expect(result.has('instant_line_notify')).toBe(false)
  })
})

// resolveOrgLimits = 「org の実効数量上限」を1点で解決する seam。
// 現状はプラン由来（resolveOrgEntitlements → planLimits）と同値＝挙動不変。
// 将来の org 別 override（相手追加パック）はこの関数の中だけで足せるようにする。
describe('resolveOrgLimits (数量上限の seam)', () => {
  function makeAdmin(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn(() => Promise.resolve(result))
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    return { from } as unknown as import('@supabase/supabase-js').SupabaseClient
  }

  it('pro row -> pro の上限（planLimits と同値・挙動不変）', async () => {
    const admin = makeAdmin({
      data: {
        plan_id: 'pro',
        status: 'active',
        current_period_end: null,
        cancel_at_period_end: false,
      },
      error: null,
    })

    const limits = await resolveOrgLimits(admin, 'org-1', NOW)

    expect(limits).toEqual(PLAN_LIMITS.pro)
    expect(limits.maxLineGroups).toBe(50)
  })

  it('no row -> free の上限（fail-closed）', async () => {
    const admin = makeAdmin({ data: null, error: null })

    const limits = await resolveOrgLimits(admin, 'org-1', NOW)

    expect(limits).toEqual(PLAN_LIMITS.free)
    expect(limits.maxLineGroups).toBe(3)
    expect(limits.maxExternalChatGroups).toBe(0)
  })

  it('DB error -> free の上限に fail-closed（throw しない）', async () => {
    const admin = makeAdmin({ data: null, error: { message: 'boom' } })

    await expect(resolveOrgLimits(admin, 'org-1', NOW)).resolves.toEqual(PLAN_LIMITS.free)
  })
})
