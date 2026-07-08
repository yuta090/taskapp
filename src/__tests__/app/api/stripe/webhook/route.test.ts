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

const upsertMock = vi.fn(() => Promise.resolve({ error: null }))
const updateEqMock = vi.fn(() => Promise.resolve({ error: null }))
const updateMock = vi.fn(() => ({ eq: updateEqMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: vi.fn(() => ({
        upsert: upsertMock,
        update: updateMock,
      })),
    })
  ),
}))

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
})
