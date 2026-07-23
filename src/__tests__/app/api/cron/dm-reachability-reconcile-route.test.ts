import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/dm-reachability-reconcile
 *
 * pg_cronが定期的に app_invoke_dm_reachability_reconcile 経由(pg_net)で叩く内部API。
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 * 実処理は reconcileDmReachability に委譲し、このルートは認証と結果のJSON化のみを行う薄い層。
 */

const reconcileMock = vi.fn()
vi.mock('@/lib/channels/dmReachabilityReconcile', () => ({
  reconcileDmReachability: (...args: unknown[]) => reconcileMock(...args),
}))

const { POST } = await import('@/app/api/cron/dm-reachability-reconcile/route')

function callPost(headers: Record<string, string> = { authorization: 'Bearer test-cron-secret' }) {
  const request = new NextRequest(new URL('/api/cron/dm-reachability-reconcile', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  })
  return POST(request)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  reconcileMock.mockResolvedValue({ scanned: 0, marked: 0, cleared: 0, errors: 0, truncated: false })
})

describe('POST /api/cron/dm-reachability-reconcile', () => {
  it('CRON_SECRET未設定は500', async () => {
    delete process.env.CRON_SECRET
    const res = await callPost({ authorization: 'Bearer anything' })
    expect(res.status).toBe(500)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('Authorizationヘッダ不正は401', async () => {
    const res = await callPost({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('Authorizationヘッダ無しは401', async () => {
    const request = new NextRequest(new URL('/api/cron/dm-reachability-reconcile', 'http://localhost:3000'), {
      method: 'POST',
    })
    const res = await POST(request)
    expect(res.status).toBe(401)
  })

  it('正しいBearerなら reconcileDmReachability を呼び、結果をそのままJSONで返す', async () => {
    reconcileMock.mockResolvedValue({ scanned: 3, marked: 1, cleared: 1, errors: 0, truncated: false })

    const res = await callPost()

    expect(res.status).toBe(200)
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    const json = await res.json()
    expect(json).toEqual({ scanned: 3, marked: 1, cleared: 1, errors: 0, truncated: false })
  })
})
