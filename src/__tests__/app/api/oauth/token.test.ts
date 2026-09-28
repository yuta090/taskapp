import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

/**
 * 引換券を合鍵に替える口。ここを通ると本物の権限が出る。
 *
 * ⚠ 守るのは4つ:
 *   - PKCE（S256）の照合。引換券を横取りされても、求めた本人しか引き換えられない
 *   - 引換券は一度きり（使い回しは store 側で合鍵ごと失効させる）
 *   - 引換券を出したつなぎ先と、引き換えに来たつなぎ先が同じであること
 *   - 戻り先が許可を求めたときと同じであること
 */

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'

let consumed: Record<string, unknown> | null = null
const createdKeys: Record<string, unknown>[] = []
const issued: Record<string, unknown>[] = []
let rotated: Record<string, unknown> | null = null

vi.mock('@/lib/mcp/oauth/store', () => ({
  getClient: async (id: string) =>
    id === 'cid-1' ? { clientId: 'cid-1', clientName: 'ChatGPT', redirectUris: [REDIRECT] } : null,
  consumeAuthorizationCode: async () => consumed,
  createOAuthApiKey: async (p: Record<string, unknown>) => {
    createdKeys.push(p)
    return 'api-key-row-1'
  },
  issueTokens: async (p: Record<string, unknown>) => {
    issued.push(p)
    return { accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3600 }
  },
  rotateRefreshToken: async () => rotated,
}))

const { POST } = await import('@/app/api/oauth/token/route')

function post(params: Record<string, string>) {
  const form = new URLSearchParams(params)
  return new NextRequest('https://agentpm.app/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
}

const VALID_CODE_GRANT = {
  grant_type: 'authorization_code',
  client_id: 'cid-1',
  code: 'the-code',
  code_verifier: VERIFIER,
  redirect_uri: REDIRECT,
}

beforeEach(() => {
  createdKeys.length = 0
  issued.length = 0
  rotated = null
  consumed = {
    id: 'code-1',
    clientId: 'cid-1',
    userId: 'user-1',
    orgId: 'org-1',
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
    allowedActions: ['read'],
  }
})

describe('/api/oauth/token — 引換券を合鍵に替える', () => {
  it('正しい引換券と code_verifier なら合鍵を返す', async () => {
    const res = await POST(post(VALID_CODE_GRANT))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBe('at-1')
    expect(body.refresh_token).toBe('rt-1')
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(3600)
  })

  it('合鍵は保存されない形で返す（Cache-Control: no-store）', async () => {
    const res = await POST(post(VALID_CODE_GRANT))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('同意した範囲で api_keys の行を作る', async () => {
    consumed = { ...consumed!, allowedActions: ['read', 'write'] }
    await POST(post(VALID_CODE_GRANT))
    expect(createdKeys[0].allowedActions).toEqual(['read', 'write'])
    expect(createdKeys[0].userId).toBe('user-1')
    expect(createdKeys[0].orgId).toBe('org-1')
  })

  it('code_verifier が違えば断り、鍵を作らない', async () => {
    const res = await POST(post({ ...VALID_CODE_GRANT, code_verifier: 'ちがう値' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
    expect(createdKeys).toEqual([])
  })

  it('code_verifier が無ければ断る（PKCE 必須）', async () => {
    const { code_verifier: _drop, ...rest } = VALID_CODE_GRANT
    void _drop
    const res = await POST(post(rest))
    expect(res.status).toBe(400)
    expect(createdKeys).toEqual([])
  })

  it('引換券が使用済み・期限切れなら断る', async () => {
    consumed = null
    const res = await POST(post(VALID_CODE_GRANT))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
    expect(createdKeys).toEqual([])
  })

  it('別のつなぎ先が引き換えようとしたら断る', async () => {
    consumed = { ...consumed!, clientId: 'cid-other' }
    const res = await POST(post(VALID_CODE_GRANT))
    expect(res.status).toBe(400)
    expect(createdKeys).toEqual([])
  })

  it('戻り先が許可を求めたときと違えば断る', async () => {
    const res = await POST(post({ ...VALID_CODE_GRANT, redirect_uri: 'https://chatgpt.com/other' }))
    expect(res.status).toBe(400)
    expect(createdKeys).toEqual([])
  })

  it('登録されていないつなぎ先は断る', async () => {
    const res = await POST(post({ ...VALID_CODE_GRANT, client_id: 'unknown' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_client')
  })
})

describe('/api/oauth/token — 合鍵の付け替え', () => {
  it('付け替えできれば新しい1組を返す', async () => {
    rotated = { accessToken: 'at-2', refreshToken: 'rt-2', expiresIn: 3600 }
    const res = await POST(post({ grant_type: 'refresh_token', client_id: 'cid-1', refresh_token: 'rt-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBe('at-2')
    expect(body.refresh_token).toBe('rt-2')
  })

  it('使い回された付け替え用は断る（store 側で系列ごと失効させている）', async () => {
    rotated = null
    const res = await POST(post({ grant_type: 'refresh_token', client_id: 'cid-1', refresh_token: 'rt-old' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
  })
})

describe('/api/oauth/token — 対応しない形', () => {
  it('知らない grant_type は断る', async () => {
    const res = await POST(post({ grant_type: 'password', client_id: 'cid-1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unsupported_grant_type')
  })
})
