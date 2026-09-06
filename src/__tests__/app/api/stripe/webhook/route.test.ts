import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/stripe/webhook
 *
 * Security-critical: must reject requests with a missing/invalid signature
 * before touching the DB, and must not throw on unknown event types.
 */

let constructEventImpl: (body: string, signature: string) => unknown

const constructWebhookEventMock = vi.fn((body: string, signature: string) => constructEventImpl(body, signature))

vi.mock('@/lib/stripe', () => ({
  constructWebhookEvent: (...args: [string, string]) => constructWebhookEventMock(...args),
}))

/** DB 応答（テストごとに差し替え）。webhook は service role（createAdminClient）で org_billing を触る */
let upsertResult: { error: unknown } = { error: null }
let updateResult: { error: unknown } = { error: null }
/** 更新前の org_billing（課金メールの遷移判定に使う） */
let billingBefore: { org_id?: string; status: string; plan_id: string } | null = null
let selectResult: { data: unknown; error: unknown } | null = null
/** payment_failed の条件付き更新（.neq().select()）で返る行 */
let paymentFailedChanged: Array<{ org_id: string; plan_id: string | null }> = []

const upsertMock = vi.fn(() => Promise.resolve(upsertResult))
const updateEqMock = vi.fn(() => {
  const thenable = Promise.resolve(updateResult)
  return Object.assign(thenable, {
    neq: () => ({ select: () => Promise.resolve({ data: paymentFailedChanged, error: updateResult.error }) }),
  })
})
const updateMock = vi.fn(() => ({ eq: updateEqMock }))
const selectMock = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve(selectResult ?? { data: billingBefore, error: null })) })) }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: upsertMock,
      update: updateMock,
      select: selectMock,
    })),
  })),
}))

const notifyMock = vi.fn((_input: Record<string, unknown>) => Promise.resolve(1))
vi.mock('@/lib/billing/billingLifecycleNotify', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/billingLifecycleNotify')>('@/lib/billing/billingLifecycleNotify')
  return { ...actual, notifyBillingLifecycle: notifyMock }
})

const { POST } = await import('@/app/api/stripe/webhook/route')

function callWebhook(body: string, signature: string | null) {
  const headers: Record<string, string> = {}
  if (signature !== null) headers['stripe-signature'] = signature
  const request = new NextRequest(new URL('/api/stripe/webhook', 'http://localhost:3000'), {
    method: 'POST',
    headers,
    body,
  })
  return POST(request)
}

beforeEach(() => {
  vi.clearAllMocks()
  billingBefore = null
  selectResult = null
  upsertResult = { error: null }
  updateResult = { error: null }
  paymentFailedChanged = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  constructEventImpl = () => {
    throw new Error('not configured for this test')
  }
})

describe('POST /api/stripe/webhook', () => {
  it('returns 400 without verifying anything when the stripe-signature header is missing', async () => {
    const response = await callWebhook('{}', null)

    expect(response.status).toBe(400)
    expect(constructWebhookEventMock).not.toHaveBeenCalled()
  })

  it('returns 400 when signature verification fails (rejects forged payloads)', async () => {
    constructEventImpl = () => {
      throw new Error('No signatures found matching the expected signature for payload')
    }

    const response = await callWebhook('{"malicious":true}', 'bad-signature')
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid signature')
    expect(upsertMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('processes checkout.session.completed and upserts org_billing', async () => {
    constructEventImpl = () => ({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { org_id: 'org-1', plan_id: 'pro' },
          customer: 'cus_123',
          subscription: 'sub_123',
        },
      },
    })

    const response = await callWebhook('{}', 'valid-sig')
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.received).toBe(true)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'org-1', plan_id: 'pro', status: 'active' })
    )
  })

  it('processes customer.subscription.updated and maps past_due status', async () => {
    constructEventImpl = () => ({
      type: 'customer.subscription.updated',
      data: {
        object: {
          metadata: { org_id: 'org-1', plan_id: 'pro' },
          status: 'past_due',
          current_period_end: 1893456000,
          cancel_at_period_end: false,
        },
      },
    })

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'past_due' }))
    expect(updateEqMock).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('maps trialing/unpaid/unknown subscription statuses correctly', async () => {
    constructEventImpl = () => ({
      type: 'customer.subscription.updated',
      data: { object: { metadata: { org_id: 'org-1', plan_id: 'pro' }, status: 'trialing' } },
    })
    await callWebhook('{}', 'valid-sig')
    expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'trialing' }))

    constructEventImpl = () => ({
      type: 'customer.subscription.updated',
      data: { object: { metadata: { org_id: 'org-1', plan_id: 'pro' }, status: 'unpaid' } },
    })
    await callWebhook('{}', 'valid-sig')
    expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'canceled' }))

    constructEventImpl = () => ({
      type: 'customer.subscription.updated',
      data: { object: { metadata: { org_id: 'org-1', plan_id: 'pro' }, status: 'some_future_status' } },
    })
    await callWebhook('{}', 'valid-sig')
    expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }))
  })

  it('skips the update (no DB write) when subscription.updated is missing org_id metadata', async () => {
    constructEventImpl = () => ({
      type: 'customer.subscription.updated',
      data: { object: { metadata: {}, status: 'active' } },
    })

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(200)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('skips the update when subscription.deleted is missing org_id metadata', async () => {
    constructEventImpl = () => ({
      type: 'customer.subscription.deleted',
      data: { object: { metadata: {} } },
    })

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(200)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('skips the update when invoice.payment_failed has no subscription id', async () => {
    constructEventImpl = () => ({
      type: 'invoice.payment_failed',
      data: { object: {} },
    })

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(200)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('processes customer.subscription.deleted by reverting the org to the free plan', async () => {
    constructEventImpl = () => ({
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { org_id: 'org-1' } } },
    })

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ plan_id: 'free', status: 'active' }))
  })

  it('processes invoice.payment_failed by marking the subscription past_due', async () => {
    constructEventImpl = () => ({
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_123' } },
    })

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'past_due' }))
    expect(updateEqMock).toHaveBeenCalledWith('stripe_subscription_id', 'sub_123')
  })

  it('does not throw and returns 200 for an unhandled/unknown event type', async () => {
    constructEventImpl = () => ({
      type: 'payment_intent.succeeded',
      data: { object: {} },
    })

    const response = await callWebhook('{}', 'valid-sig')
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.received).toBe(true)
    expect(upsertMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('skips the checkout handler side effect (no upsert) when org_id/plan_id metadata is missing', async () => {
    constructEventImpl = () => ({
      type: 'checkout.session.completed',
      data: { object: { metadata: {}, customer: 'cus_123', subscription: 'sub_123' } },
    })

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(200)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('returns 500 when an unexpected error occurs while handling a verified event', async () => {
    constructEventImpl = () => ({
      type: 'checkout.session.completed',
      data: { object: { metadata: { org_id: 'org-1', plan_id: 'pro' } } },
    })
    upsertMock.mockRejectedValueOnce(new Error('db down'))

    const response = await callWebhook('{}', 'valid-sig')

    expect(response.status).toBe(500)
  })

  describe('課金の出来事メール（状態が遷移したときだけ1通）', () => {
    const paidEvent = (type: string, object: Record<string, unknown>) => {
      constructEventImpl = () => ({ type, data: { object } })
    }

    it('checkout 完了: free→pro で有効化メール。同じ webhook の再送（すでに pro active）では送らない', async () => {
      billingBefore = { status: 'active', plan_id: 'free' }
      paidEvent('checkout.session.completed', { metadata: { org_id: 'org-1', plan_id: 'pro' }, customer: 'cus_1', subscription: 'sub_1' })
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
      expect(notifyMock.mock.calls[0][0]).toMatchObject({ orgId: 'org-1', key: 'billing_activated', planId: 'pro' })

      billingBefore = { status: 'active', plan_id: 'pro' }
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
    })

    it('invoice.payment_failed: 条件付き更新で遷移した行にだけ失敗メール。すでに past_due（0行）なら送らない', async () => {
      paymentFailedChanged = [{ org_id: 'org-1', plan_id: 'pro' }]
      paidEvent('invoice.payment_failed', { subscription: 'sub_1' })
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
      expect(notifyMock.mock.calls[0][0]).toMatchObject({ orgId: 'org-1', key: 'billing_payment_failed', planId: 'pro' })

      paymentFailedChanged = []
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
    })

    it('DB の読み取りに失敗したら送らない（初回扱いで有効化メールを誤送しない）', async () => {
      selectResult = { data: null, error: { message: 'permission denied' } }
      paidEvent('checkout.session.completed', { metadata: { org_id: 'org-1', plan_id: 'pro' }, customer: 'cus_1', subscription: 'sub_1' })
      const res = await callWebhook('{}', 'sig')
      expect(res.status).toBe(200)
      expect(upsertMock).toHaveBeenCalledTimes(1)
      expect(notifyMock).not.toHaveBeenCalled()
    })

    it('DB の更新に失敗したら送らない（有効になっていないのに「有効になりました」と伝えない）', async () => {
      billingBefore = { status: 'active', plan_id: 'free' }
      upsertResult = { error: { message: 'boom' } }
      paidEvent('checkout.session.completed', { metadata: { org_id: 'org-1', plan_id: 'pro' }, customer: 'cus_1', subscription: 'sub_1' })
      await callWebhook('{}', 'sig')
      expect(notifyMock).not.toHaveBeenCalled()
      updateResult = { error: { message: 'boom' } }
      billingBefore = { status: 'past_due', plan_id: 'pro' }
      paidEvent('customer.subscription.updated', { status: 'active', metadata: { org_id: 'org-1', plan_id: 'pro' }, items: { data: [] } })
      await callWebhook('{}', 'sig')
      expect(notifyMock).not.toHaveBeenCalled()
    })

    it('subscription.updated: past_due→active は有効化メール、active→active は送らない', async () => {
      billingBefore = { status: 'past_due', plan_id: 'pro' }
      paidEvent('customer.subscription.updated', { status: 'active', metadata: { org_id: 'org-1', plan_id: 'pro' }, items: { data: [] }, current_period_end: Date.UTC(2026, 9, 6, 16) / 1000 })
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
      expect(notifyMock.mock.calls[0][0]).toMatchObject({ key: 'billing_activated', orgId: 'org-1', planId: 'pro' })

      billingBefore = { status: 'active', plan_id: 'pro' }
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
    })

    it('subscription.deleted: pro→free で解約メール（解約したプラン名を渡す）。free のままなら送らない', async () => {
      billingBefore = { status: 'active', plan_id: 'pro' }
      paidEvent('customer.subscription.deleted', { metadata: { org_id: 'org-1' } })
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
      expect(notifyMock.mock.calls[0][0]).toMatchObject({ orgId: 'org-1', key: 'billing_canceled', planId: 'pro' })

      billingBefore = { status: 'active', plan_id: 'free' }
      await callWebhook('{}', 'sig')
      expect(notifyMock).toHaveBeenCalledTimes(1)
    })

    it('メール送信の失敗は webhook を失敗させない（200 のまま・DB 更新は済んでいる）', async () => {
      billingBefore = { status: 'active', plan_id: 'free' }
      notifyMock.mockRejectedValueOnce(new Error('mail down'))
      paidEvent('checkout.session.completed', { metadata: { org_id: 'org-1', plan_id: 'pro' }, customer: 'cus_1', subscription: 'sub_1' })
      const res = await callWebhook('{}', 'sig')
      expect(res.status).toBe(200)
      expect(upsertMock).toHaveBeenCalledTimes(1)
    })
  })
})
