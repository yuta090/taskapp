import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 同意画面の「許可する」を受ける口。本物の権限が出る瞬間。
 *
 * ⚠ 守るのは:
 *   - ログイン済み本人であること
 *   - その組織の社内メンバーであること（相手先・協力会社は不可）
 *   - 戻り先が登録どおり完全一致であること
 *   - 不正な入力のときは、戻り先へ飛ばさずこちらで止めること（open redirect を作らない）
 */

const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const codes: Record<string, unknown>[] = []
let currentUser: { id: string } | null = { id: 'user-1' }
let connectable = true

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}))

vi.mock('@/lib/mcp/oauth/store', () => ({
  getClient: async (id: string) =>
    id === 'cid-1' ? { clientId: 'cid-1', clientName: 'ChatGPT', redirectUris: [REDIRECT] } : null,
  createAuthorizationCode: async (c: Record<string, unknown>) => {
    codes.push(c)
    return 'issued-code'
  },
}))

vi.mock('@/lib/mcp/oauth/consent', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, canConnectOrg: async () => connectable }
})

const { POST } = await import('@/app/api/oauth/consent/route')

function post(fields: Record<string, string>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new NextRequest('https://agentpm.app/api/oauth/consent', { method: 'POST', body: form })
}

const APPROVE = {
  client_id: 'cid-1',
  redirect_uri: REDIRECT,
  state: 'st-1',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  org_id: 'org-1',
  level: 'read',
  decision: 'approve',
}

beforeEach(() => {
  codes.length = 0
  currentUser = { id: 'user-1' }
  connectable = true
})

describe('/api/oauth/consent — 許可する', () => {
  it('引換券を作って、登録どおりの戻り先へ返す', async () => {
    const res = await POST(post(APPROVE))
    expect(res.status).toBe(303)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin + location.pathname).toBe(REDIRECT)
    expect(location.searchParams.get('code')).toBe('issued-code')
    expect(location.searchParams.get('state')).toBe('st-1')
  })

  it('「見るだけ」なら read だけを渡す', async () => {
    await POST(post(APPROVE))
    expect(codes[0].allowedActions).toEqual(['read'])
  })

  it('「見る＋書く」でも、消す・一括は渡さない', async () => {
    await POST(post({ ...APPROVE, level: 'write' }))
    expect(codes[0].allowedActions).toEqual(['read', 'write'])
  })
})

describe('/api/oauth/consent — 断る', () => {
  it('許可しないを押したら、引換券を作らず戻り先へ error を返す', async () => {
    const res = await POST(post({ ...APPROVE, decision: 'deny' }))
    expect(res.status).toBe(303)
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied')
    expect(codes).toEqual([])
  })
})

describe('/api/oauth/consent — 通してはいけないもの', () => {
  it('戻り先が登録と違えば、そこへ飛ばさず 400 で止める', async () => {
    const res = await POST(post({ ...APPROVE, redirect_uri: 'https://evil.test/cb' }))
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
    expect(codes).toEqual([])
  })

  it('登録されていないつなぎ先は 400 で止める', async () => {
    const res = await POST(post({ ...APPROVE, client_id: 'unknown' }))
    expect(res.status).toBe(400)
    expect(codes).toEqual([])
  })

  it('ログインしていなければ引換券を作らない', async () => {
    currentUser = null
    const res = await POST(post(APPROVE))
    expect(res.status).toBe(401)
    expect(codes).toEqual([])
  })

  it('その組織の社内メンバーでなければ断る（相手先・協力会社）', async () => {
    connectable = false
    const res = await POST(post(APPROVE))
    expect(res.status).toBe(403)
    expect(codes).toEqual([])
  })

  it('PKCE の指定が無ければ断る', async () => {
    const res = await POST(post({ ...APPROVE, code_challenge: '' }))
    expect(res.status).toBe(400)
    expect(codes).toEqual([])
  })

  it('知らない範囲の指定は断る', async () => {
    const res = await POST(post({ ...APPROVE, level: 'admin' }))
    expect(res.status).toBe(400)
    expect(codes).toEqual([])
  })
})
