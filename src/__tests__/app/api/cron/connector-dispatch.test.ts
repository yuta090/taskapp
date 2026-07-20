import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/connector-dispatch — pg_cron(5分間隔)からの Bearer CRON_SECRET 呼び出し専用。
 * connector_jobs を claim して provider(multica/gtasks)へ配達する。sink-dispatch と同一の認証形。
 */

const dispatchMock = vi.fn()
vi.mock('@/lib/connectors/dispatch', () => ({
  dispatchConnectorJobsBatch: (...args: unknown[]) => dispatchMock(...args),
}))

const { POST } = await import('@/app/api/cron/connector-dispatch/route')

function callPost(headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL('/api/cron/connector-dispatch', 'http://localhost:3000'), {
    method: 'POST',
    headers,
  })
  return POST(request)
}

describe('POST /api/cron/connector-dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    dispatchMock.mockResolvedValue({ claimed: 0, done: 0, tempFailed: 0, dead: 0 })
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const response = await callPost({ authorization: 'Bearer anything' })
    expect(response.status).toBe(500)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const response = await callPost()
    expect(response.status).toBe(401)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the token does not match CRON_SECRET', async () => {
    const response = await callPost({ authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the dispatch summary on a valid secret', async () => {
    dispatchMock.mockResolvedValue({ claimed: 3, done: 2, tempFailed: 1, dead: 0 })
    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({ claimed: 3, done: 2, tempFailed: 1, dead: 0 })
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })
})
