import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/sink-dispatch — pg_cron(5分間隔)からのBearer CRON_SECRET呼び出し専用。
 * client-remindersと同じ認証パターン。
 */

const dispatchBatchMock = vi.fn()
vi.mock('@/lib/sinks/dispatcher', () => ({
  dispatchBatch: (...args: unknown[]) => dispatchBatchMock(...args),
}))

const { POST } = await import('@/app/api/cron/sink-dispatch/route')

function callPost(headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL('/api/cron/sink-dispatch', 'http://localhost:3000'), {
    method: 'POST',
    headers,
  })
  return POST(request)
}

describe('POST /api/cron/sink-dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    dispatchBatchMock.mockResolvedValue({ claimed: 0, sent: 0, failed: 0, dead: 0, errors: [] })
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const response = await callPost({ authorization: 'Bearer anything' })
    expect(response.status).toBe(500)
    expect(dispatchBatchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const response = await callPost()
    expect(response.status).toBe(401)
    expect(dispatchBatchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the token does not match CRON_SECRET', async () => {
    const response = await callPost({ authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
    expect(dispatchBatchMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the dispatch summary on a valid secret', async () => {
    dispatchBatchMock.mockResolvedValue({ claimed: 3, sent: 2, failed: 1, dead: 0, errors: [] })
    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({ claimed: 3, sent: 2, failed: 1, dead: 0, errors: [] })
    expect(dispatchBatchMock).toHaveBeenCalledTimes(1)
  })
})
