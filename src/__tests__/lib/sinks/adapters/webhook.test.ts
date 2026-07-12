import { describe, it, expect, vi, beforeEach } from 'vitest'

const safeFetchMock = vi.fn()
vi.mock('@/lib/sinks/ssrf', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}))

const { deliverWebhook } = await import('@/lib/sinks/adapters/webhook')

const SINK = {
  id: 'sink-1',
  provider: 'webhook' as const,
  config: { url: 'https://example.com/hook' },
  secret: 'whsec_test',
}

const DELIVERY = {
  id: 'delivery-1',
  eventType: 'task.created',
  eventKey: 'task.created:task-1:evt-1',
  payload: { occurred_at: '2026-07-11T00:00:00.000Z', task: { id: 'task-1', title: '発注' } },
}

describe('deliverWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs a signed body with the correct envelope shape', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, bodyText: 'ok' })

    await deliverWebhook(SINK, DELIVERY)

    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = safeFetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/hook')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.headers['X-AgentPM-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)

    const body = JSON.parse(options.body)
    expect(body).toEqual({
      id: 'delivery-1',
      event: 'task.created',
      event_key: 'task.created:task-1:evt-1',
      occurred_at: '2026-07-11T00:00:00.000Z',
      data: { task: { id: 'task-1', title: '発注' } },
    })
  })

  it('returns ok on 2xx', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 204, bodyText: '' })
    const result = await deliverWebhook(SINK, DELIVERY)
    expect(result).toEqual({ ok: true, responseStatus: 204 })
  })

  it('treats 3xx as a permanent failure (redirects are not followed)', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 301, bodyText: '' })
    const result = await deliverWebhook(SINK, DELIVERY)
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(result.responseStatus).toBe(301)
  })

  it('passes through a 4xx/5xx response status without classifying (dispatcher classifies)', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 500, bodyText: 'boom' })
    const result = await deliverWebhook(SINK, DELIVERY)
    expect(result.ok).toBe(false)
    expect(result.permanent).toBeUndefined()
    expect(result.responseStatus).toBe(500)
  })

  it('marks SSRF-blocked results as permanent (do not retry an attack target forever)', async () => {
    safeFetchMock.mockResolvedValue({ ok: false, error: 'ssrf_blocked:ip_denied' })
    const result = await deliverWebhook(SINK, DELIVERY)
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(result.error).toBe('ssrf_blocked:ip_denied')
  })

  it('marks network errors as retryable (permanent undefined)', async () => {
    safeFetchMock.mockResolvedValue({ ok: false, error: 'fetch failed: ECONNREFUSED' })
    const result = await deliverWebhook(SINK, DELIVERY)
    expect(result.ok).toBe(false)
    expect(result.permanent).toBeUndefined()
  })
})
