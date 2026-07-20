import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/connector-import — pg_cron(15分間隔)からの Bearer CRON_SECRET 呼び出し専用。
 * import_enabled な gtasks 接続を updatedMin で差分ポーリングし、外部起案を TaskApp へ取り込む。
 */

const importMock = vi.fn()
vi.mock('@/lib/google-tasks/import', () => ({
  importGoogleTasksBatch: (...args: unknown[]) => importMock(...args),
}))

const { POST } = await import('@/app/api/cron/connector-import/route')

function callPost(headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL('/api/cron/connector-import', 'http://localhost:3000'), {
    method: 'POST',
    headers,
  })
  return POST(request)
}

describe('POST /api/cron/connector-import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    importMock.mockResolvedValue({ connections: 0, created: 0, updated: 0, completed: 0, skipped: 0 })
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const response = await callPost({ authorization: 'Bearer anything' })
    expect(response.status).toBe(500)
    expect(importMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const response = await callPost()
    expect(response.status).toBe(401)
    expect(importMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the token does not match CRON_SECRET', async () => {
    const response = await callPost({ authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
    expect(importMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the import summary on a valid secret', async () => {
    importMock.mockResolvedValue({ connections: 2, created: 5, updated: 1, completed: 3, skipped: 0 })
    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({ connections: 2, created: 5, updated: 1, completed: 3, skipped: 0 })
    expect(importMock).toHaveBeenCalledTimes(1)
  })
})
