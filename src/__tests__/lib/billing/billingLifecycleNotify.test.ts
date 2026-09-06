import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()
vi.mock('@/lib/email/billingLifecycle', () => ({ sendBillingLifecycleEmail: sendMock }))

let orgRow: { name: string } | null = { name: 'サンプル社' }
let admins: Array<{ user_id: string }> = [{ user_id: 'u1' }, { user_id: 'u2' }]
const getUserByIdMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === 'organizations'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: orgRow }) }) }) }
        : { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: admins }) }) }) },
    auth: { admin: { getUserById: getUserByIdMock } },
  }),
}))

const { shouldNotifyBillingTransition, notifyBillingLifecycle, planLabelOf } = await import('@/lib/billing/billingLifecycleNotify')

beforeEach(() => {
  vi.clearAllMocks()
  orgRow = { name: 'サンプル社' }
  admins = [{ user_id: 'u1' }, { user_id: 'u2' }]
  getUserByIdMock.mockImplementation((id: string) => Promise.resolve({ data: { user: { email: `${id}@example.com` } } }))
  sendMock.mockResolvedValue({ success: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('shouldNotifyBillingTransition（純関数・冪等の要）', () => {
  const active = (plan: string) => ({ status: 'active', plan_id: plan })
  it('有料開始: free→pro active で送る。pro active→pro active（重複 webhook）は送らない', () => {
    expect(shouldNotifyBillingTransition('checkout_completed', active('free'), active('pro'))).toBe('billing_activated')
    expect(shouldNotifyBillingTransition('checkout_completed', null, active('pro'))).toBe('billing_activated')
    expect(shouldNotifyBillingTransition('checkout_completed', active('pro'), active('pro'))).toBeNull()
    expect(shouldNotifyBillingTransition('subscription_updated', active('pro'), active('pro'))).toBeNull()
    // 未払いからの復帰も「有効になった」で1通
    expect(shouldNotifyBillingTransition('subscription_updated', { status: 'past_due', plan_id: 'pro' }, active('pro'))).toBe('billing_activated')
    // free で active は送らない
    expect(shouldNotifyBillingTransition('checkout_completed', null, active('free'))).toBeNull()
  })
  it('支払い失敗: active→past_due で送る。past_due→past_due は送らない', () => {
    expect(shouldNotifyBillingTransition('payment_failed', active('pro'), { status: 'past_due', plan_id: 'pro' })).toBe('billing_payment_failed')
    expect(shouldNotifyBillingTransition('subscription_updated', active('pro'), { status: 'past_due', plan_id: 'pro' })).toBe('billing_payment_failed')
    expect(shouldNotifyBillingTransition('payment_failed', { status: 'past_due', plan_id: 'pro' }, { status: 'past_due', plan_id: 'pro' })).toBeNull()
  })
  it('解約: pro→free で送る。前が free なら送らない', () => {
    expect(shouldNotifyBillingTransition('subscription_deleted', active('pro'), active('free'))).toBe('billing_canceled')
    expect(shouldNotifyBillingTransition('subscription_deleted', active('free'), active('free'))).toBeNull()
    expect(shouldNotifyBillingTransition('subscription_deleted', null, active('free'))).toBeNull()
  })
  it('trialing / canceled への遷移は送らない', () => {
    expect(shouldNotifyBillingTransition('subscription_updated', active('pro'), { status: 'trialing', plan_id: 'pro' })).toBeNull()
    expect(shouldNotifyBillingTransition('subscription_updated', active('pro'), { status: 'canceled', plan_id: 'pro' })).toBeNull()
  })
})

describe('notifyBillingLifecycle', () => {
  it('owner/admin 全員に送る（プラン名は表示名）', async () => {
    const n = await notifyBillingLifecycle({ orgId: 'org-1', key: 'billing_activated', planId: 'pro', nextBillingDateLabel: '2026年10月7日' })
    expect(n).toBe(2)
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: 'u1@example.com', key: 'billing_activated', orgName: 'サンプル社', planLabel: 'Pro', nextBillingDateLabel: '2026年10月7日' })
  })
  it('宛先が無ければ送らない・1人の失敗は他を止めない', async () => {
    admins = []
    expect(await notifyBillingLifecycle({ orgId: 'org-1', key: 'billing_canceled', planId: 'pro' })).toBe(0)
    admins = [{ user_id: 'u1' }, { user_id: 'u2' }]
    sendMock.mockRejectedValueOnce(new Error('boom'))
    expect(await notifyBillingLifecycle({ orgId: 'org-1', key: 'billing_canceled', planId: 'pro' })).toBe(1)
  })
  it('planLabelOf', () => {
    expect(planLabelOf('pro')).toBe('Pro')
    expect(planLabelOf('unknown_plan')).toBe('unknown_plan')
    expect(planLabelOf(null)).toBe('')
  })
})
