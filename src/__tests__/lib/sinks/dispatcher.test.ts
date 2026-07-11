import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * dispatcher: claim -> deliver(webhook) -> classify -> complete -> (justBecameError通知)
 * のオーケストレーション。store/adapter/notifyはモックしてロジックのみ検証する。
 */

const claimSinkDeliveriesMock = vi.fn()
const findDeliverableSinksByIdsMock = vi.fn()
const completeSinkDeliveryMock = vi.fn()
const deliverWebhookMock = vi.fn()
const notifySinkBecameErrorMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/sinks/store', () => ({
  claimSinkDeliveries: (...args: unknown[]) => claimSinkDeliveriesMock(...args),
  findDeliverableSinksByIds: (...args: unknown[]) => findDeliverableSinksByIdsMock(...args),
  completeSinkDelivery: (...args: unknown[]) => completeSinkDeliveryMock(...args),
}))
vi.mock('@/lib/sinks/adapters/webhook', () => ({
  deliverWebhook: (...args: unknown[]) => deliverWebhookMock(...args),
}))
vi.mock('@/lib/sinks/notify', () => ({
  notifySinkBecameError: (...args: unknown[]) => notifySinkBecameErrorMock(...args),
}))

const { dispatchBatch } = await import('@/lib/sinks/dispatcher')

const SINK = { id: 'sink-1', provider: 'webhook' as const, config: { url: 'https://example.com/hook' }, secret: 's' }

function delivery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    orgId: 'org-1',
    sinkId: 'sink-1',
    digestTaskId: 'task-1',
    eventType: 'task.created',
    eventKey: 'task.created:task-1:evt-1',
    payload: { occurredAt: '2026-07-11T00:00:00.000Z', task: { id: 'task-1' } },
    attempts: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  findDeliverableSinksByIdsMock.mockResolvedValue(new Map([['sink-1', SINK]]))
})

describe('dispatchBatch', () => {
  it('returns an empty summary when nothing is claimed', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([])
    const summary = await dispatchBatch()
    expect(summary).toEqual({ claimed: 0, sent: 0, failed: 0, dead: 0, errors: [] })
    expect(findDeliverableSinksByIdsMock).not.toHaveBeenCalled()
  })

  it('marks a successful delivery as sent and resets consecutive_failures', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([delivery()])
    deliverWebhookMock.mockResolvedValue({ ok: true, responseStatus: 200 })
    completeSinkDeliveryMock.mockResolvedValue({
      deliveryStatus: 'sent',
      sinkStatus: 'active',
      consecutiveFailures: 0,
      justBecameError: false,
    })

    const summary = await dispatchBatch()

    expect(completeSinkDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'd1', outcome: 'sent', countsTowardFailures: false }),
    )
    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0, dead: 0, errors: [] })
  })

  it('classifies a 500 as temporary and schedules a retry (status=failed)', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([delivery()])
    deliverWebhookMock.mockResolvedValue({ ok: false, responseStatus: 500, error: 'boom' })
    completeSinkDeliveryMock.mockResolvedValue({
      deliveryStatus: 'failed',
      sinkStatus: 'active',
      consecutiveFailures: 1,
      justBecameError: false,
    })

    const summary = await dispatchBatch()

    expect(completeSinkDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'temporary_fail', countsTowardFailures: true }),
    )
    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 1, dead: 0, errors: [] })
  })

  it('classifies a 404 as permanent, does not count toward failures, and goes dead', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([delivery()])
    deliverWebhookMock.mockResolvedValue({ ok: false, responseStatus: 404, error: 'not found' })
    completeSinkDeliveryMock.mockResolvedValue({
      deliveryStatus: 'dead',
      sinkStatus: 'active',
      consecutiveFailures: 0,
      justBecameError: false,
    })

    const summary = await dispatchBatch()

    expect(completeSinkDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'permanent_fail', countsTowardFailures: false }),
    )
    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 0, dead: 1, errors: [] })
  })

  it('treats adapter permanent=true (e.g. SSRF blocked) as a permanent failure regardless of status', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([delivery()])
    deliverWebhookMock.mockResolvedValue({ ok: false, permanent: true, error: 'ssrf_blocked:ip_denied' })
    completeSinkDeliveryMock.mockResolvedValue({
      deliveryStatus: 'dead',
      sinkStatus: 'active',
      consecutiveFailures: 1,
      justBecameError: false,
    })

    await dispatchBatch()

    expect(completeSinkDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'permanent_fail', countsTowardFailures: true }),
    )
  })

  it('fires notifySinkBecameError when the sink just crossed the failure threshold', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([delivery()])
    deliverWebhookMock.mockResolvedValue({ ok: false, responseStatus: 500, error: 'boom' })
    completeSinkDeliveryMock.mockResolvedValue({
      deliveryStatus: 'dead',
      sinkStatus: 'error',
      consecutiveFailures: 20,
      justBecameError: true,
    })

    await dispatchBatch()

    expect(notifySinkBecameErrorMock).toHaveBeenCalledWith('sink-1', 'org-1')
  })

  it('respects the per-sink cap in the underlying claim call', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([])
    await dispatchBatch({ totalLimit: 50, perSinkLimit: 3 })
    expect(claimSinkDeliveriesMock).toHaveBeenCalledWith(50, 3)
  })

  it('handles an unresolvable sink (e.g. Notion/Sheets not implemented yet) as a permanent failure without calling the adapter', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([delivery({ sinkId: 'sink-unknown' })])
    findDeliverableSinksByIdsMock.mockResolvedValue(new Map())
    completeSinkDeliveryMock.mockResolvedValue({
      deliveryStatus: 'dead',
      sinkStatus: 'active',
      consecutiveFailures: 0,
      justBecameError: false,
    })

    const summary = await dispatchBatch()

    expect(deliverWebhookMock).not.toHaveBeenCalled()
    expect(completeSinkDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'permanent_fail', countsTowardFailures: false }),
    )
    expect(summary.dead).toBe(1)
  })

  it('collects per-delivery errors without aborting the whole batch', async () => {
    claimSinkDeliveriesMock.mockResolvedValue([delivery({ id: 'd1' }), delivery({ id: 'd2' })])
    deliverWebhookMock.mockResolvedValue({ ok: true, responseStatus: 200 })
    completeSinkDeliveryMock
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ deliveryStatus: 'sent', sinkStatus: 'active', consecutiveFailures: 0, justBecameError: false })

    const summary = await dispatchBatch()

    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0]).toContain('db down')
    expect(summary.sent).toBe(1)
  })
})
