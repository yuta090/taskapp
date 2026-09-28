import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * つなぎ先の登録。誰でも叩ける口なので、ここで形を固定する。
 *
 * ⚠ 登録できること自体は権限ではない。ここを通っても、本人が同意画面で承諾するまで
 * データには一切触れない。守るのは「なりすましの戻り先を登録させない」こと。
 */

const registered: { clientName: string; redirectUris: string[] }[] = []
let overLimit = false

vi.mock('@/lib/mcp/oauth/store', () => ({
  tooManyRecentRegistrations: async () => overLimit,
  registerClient: async (p: { clientName: string; redirectUris: string[] }) => {
    registered.push(p)
    return { clientId: 'cid-1', clientName: p.clientName, redirectUris: p.redirectUris }
  },
}))

const { POST } = await import('@/app/api/oauth/register/route')

function post(body: unknown) {
  return new NextRequest('https://agentpm.app/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const OK = {
  client_name: 'ChatGPT',
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
}

beforeEach(() => {
  registered.length = 0
  overLimit = false
})

describe('/api/oauth/register', () => {
  it('まっとうな登録は 201 で client_id を返す', async () => {
    const res = await POST(post(OK))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.client_id).toBe('cid-1')
    expect(body.token_endpoint_auth_method).toBe('none')
  })

  it('http の戻り先（ループバック以外）は断る', async () => {
    const res = await POST(post({ ...OK, redirect_uris: ['http://evil.test/cb'] }))
    expect(res.status).toBe(400)
    expect(registered).toEqual([])
  })

  it('手元の開発ツール向けのループバックは受け付ける', async () => {
    const res = await POST(post({ ...OK, redirect_uris: ['http://127.0.0.1:6274/cb'] }))
    expect(res.status).toBe(201)
  })

  it('名前が無ければ断る', async () => {
    const res = await POST(post({ ...OK, client_name: '   ' }))
    expect(res.status).toBe(400)
    expect(registered).toEqual([])
  })

  it('名前の制御文字は落として保存する', async () => {
    await POST(post({ ...OK, client_name: 'Chat\nGPT' }))
    expect(registered[0].clientName).toBe('ChatGPT')
  })

  it('戻り先が多すぎる登録は断る', async () => {
    const res = await POST(post({ ...OK, redirect_uris: Array(6).fill('https://a.test/cb') }))
    expect(res.status).toBe(400)
  })

  it('対応しない受け取り方は断る', async () => {
    expect((await POST(post({ ...OK, response_types: ['token'] }))).status).toBe(400)
    expect((await POST(post({ ...OK, grant_types: ['implicit'] }))).status).toBe(400)
    expect((await POST(post({ ...OK, token_endpoint_auth_method: 'client_secret_post' }))).status).toBe(400)
    expect(registered).toEqual([])
  })

  it('同じ相手からの登録が多すぎたら 429', async () => {
    overLimit = true
    const res = await POST(post(OK))
    expect(res.status).toBe(429)
    expect(registered).toEqual([])
  })
})
