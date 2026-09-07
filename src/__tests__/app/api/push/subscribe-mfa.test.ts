import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 一般 API の二要素認証ガード（結合）: 登録済み × コード未入力(aal1) は service role で触る前に 403。
 * push/subscribe を代表例にする（同じ mfaGuardResponse を 16 ルートで使っている）。
 */
function jwt(payload: Record<string, unknown>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`
}
let aal: 'aal1' | 'aal2' = 'aal1'
let factors: Array<{ status: string }> = []
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'u@example.com' } }, error: null }),
        getSession: () => Promise.resolve({ data: { session: { access_token: jwt({ aal }) } } }),
        mfa: { listFactors: () => Promise.resolve({ data: { all: factors }, error: null }) },
      },
    }),
}))
const upsertMock = vi.fn(() => Promise.resolve({ error: null }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ upsert: upsertMock }) }) }))

const { POST } = await import('@/app/api/push/subscribe/route')
const call = () =>
  POST(
    new NextRequest('http://localhost:3000/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } }),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  aal = 'aal1'
  factors = []
})

describe('二要素認証ガード（push/subscribe）', () => {
  it('登録済み × aal1 は 403 で、DB には触らない', async () => {
    factors = [{ status: 'verified' }]
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('mfa_required')
    expect(upsertMock).not.toHaveBeenCalled()
  })
  it('登録済み × aal2 と、未登録 × aal1 は通す（403 にならない）', async () => {
    factors = [{ status: 'verified' }]
    aal = 'aal2'
    expect((await call()).status).not.toBe(403)
    factors = []
    aal = 'aal1'
    expect((await call()).status).not.toBe(403)
  })
})
