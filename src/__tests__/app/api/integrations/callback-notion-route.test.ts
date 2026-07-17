import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

/**
 * GET /api/integrations/callback/notion?code=...&state=...
 * handleNotionCallback: トークン交換(Basic認証)→owner_type='org'でupsert→
 * 秘書コンソールの連携タブへリダイレクト(既存/settings/integrationsとは別導線)。
 */

const getUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}))

const upsertMock = vi.fn()
const fromMock = vi.fn(() => ({ upsert: upsertMock }))
// トークンは暗号化して保存する(20260717075717)。buildTokenColumnsがencrypt_system_secretを呼ぶ。
const rpcMock = vi.fn((fn: string, args: Record<string, string>) =>
  fn === 'encrypt_system_secret'
    ? Promise.resolve({ data: `enc(${args.plaintext})`, error: null })
    : Promise.reject(new Error(`unexpected rpc: ${fn}`)),
)
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const exchangeNotionCodeMock = vi.fn()
vi.mock('@/lib/notion/client', () => ({
  exchangeNotionCode: (...args: unknown[]) => exchangeNotionCodeMock(...args),
}))

// 他providerのハンドラは今回のテスト対象外なのでimportエラーにならないようスタブする
vi.mock('@/lib/google-calendar/client', () => ({ exchangeCodeForTokens: vi.fn() }))
vi.mock('@/lib/zoom/client', () => ({ exchangeZoomCode: vi.fn() }))
vi.mock('@/lib/teams/client', () => ({ exchangeTeamsCode: vi.fn() }))

const { GET } = await import('@/app/api/integrations/callback/[provider]/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const STATE_SECRET = 'test-state-secret'

function signedState(payloadObj: Record<string, unknown>) {
  const payload = JSON.stringify(payloadObj)
  const signature = createHmac('sha256', STATE_SECRET).update(payload).digest('hex')
  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64url')
}

function callGet(provider: string, params: { code?: string; state?: string } = {}) {
  const url = new URL(`http://localhost:3000/api/integrations/callback/${provider}`)
  if (params.code) url.searchParams.set('code', params.code)
  if (params.state) url.searchParams.set('state', params.state)
  const request = new NextRequest(url)
  return GET(request, { params: Promise.resolve({ provider }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OAUTH_STATE_SECRET = STATE_SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  upsertMock.mockResolvedValue({ error: null })
  exchangeNotionCodeMock.mockResolvedValue({
    accessToken: 'secret_abc',
    workspaceId: 'ws-1',
    workspaceName: 'Acme Workspace',
    workspaceIcon: 'https://example.com/icon.png',
    botId: 'bot-1',
  })
})

describe('GET /api/integrations/callback/notion', () => {
  it('exchanges the code, upserts an org-owned connection, and redirects to the secretary integrations tab', async () => {
    const state = signedState({ provider: 'notion', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('notion', { code: 'auth-code-1', state })

    expect(exchangeNotionCodeMock).toHaveBeenCalledWith('auth-code-1')
    expect(fromMock).toHaveBeenCalledWith('integration_connections')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'notion',
        owner_type: 'org',
        owner_id: ORG_ID,
        org_id: ORG_ID,
        access_token: 'secret_abc',
        access_token_encrypted: 'enc(secret_abc)',
        token_expires_at: null,
        status: 'active',
        metadata: expect.objectContaining({
          workspace_id: 'ws-1',
          workspace_name: 'Acme Workspace',
          bot_id: 'bot-1',
        }),
      }),
      { onConflict: 'provider,owner_type,owner_id' },
    )

    // Notionは無期限トークンでrefresh_tokenを持たない。buildTokenColumnsはrefreshTokenが
    // falsyならキー自体を含めない(新規行では列がnullのまま作られ、on conflict時は既存値が
    // 保持される。Notionは元々値を持たないので結果は同じ)。
    const upsertPayload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(upsertPayload).not.toHaveProperty('refresh_token')
    expect(upsertPayload).not.toHaveProperty('refresh_token_encrypted')

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      `https://app.example.com/${ORG_ID}/secretary/integrations?integration=notion&status=connected`,
    )
  })

  it('redirects with status=error when the token exchange fails', async () => {
    exchangeNotionCodeMock.mockRejectedValue(new Error('Notion token exchange failed (400)'))
    const state = signedState({ provider: 'notion', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('notion', { code: 'bad-code', state })

    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain(`/${ORG_ID}/secretary/integrations`)
    expect(location).toContain('status=error')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('redirects with status=error when the upsert fails', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'db error' } })
    const state = signedState({ provider: 'notion', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('notion', { code: 'auth-code-1', state })

    const location = response.headers.get('location') ?? ''
    expect(location).toContain(`/${ORG_ID}/secretary/integrations`)
    expect(location).toContain('status=error')
  })

  it('rejects an invalid signed state before exchanging any code', async () => {
    const response = await callGet('notion', { code: 'auth-code-1', state: 'tampered' })
    expect(exchangeNotionCodeMock).not.toHaveBeenCalled()
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=invalid_state')
  })
})
