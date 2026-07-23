import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

/**
 * GET /api/integrations/callback/google_sheets?code=...&state=...
 * handleGoogleSheetsCallback: トークン交換→owner_type='org'でupsert→秘書コンソールの連携タブへ
 * リダイレクト(notionと同じタブ)。refreshTokenがnullでも保存する(token-managerが後でexpired化する)。
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

const exchangeGoogleSheetsCodeMock = vi.fn()
vi.mock('@/lib/google-sheets/client', () => ({
  exchangeGoogleSheetsCode: (...args: unknown[]) => exchangeGoogleSheetsCodeMock(...args),
}))

// 他providerのハンドラは今回のテスト対象外なのでimportエラーにならないようスタブする
vi.mock('@/lib/google-calendar/client', () => ({ exchangeCodeForTokens: vi.fn() }))
vi.mock('@/lib/zoom/client', () => ({ exchangeZoomCode: vi.fn() }))
vi.mock('@/lib/teams/client', () => ({ exchangeTeamsCode: vi.fn() }))
vi.mock('@/lib/notion/client', () => ({ exchangeNotionCode: vi.fn() }))

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
  exchangeGoogleSheetsCodeMock.mockResolvedValue({
    accessToken: 'access-abc',
    refreshToken: 'refresh-abc',
    expiresAt: new Date('2026-07-12T01:00:00.000Z'),
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
  })
})

describe('GET /api/integrations/callback/google_sheets', () => {
  it('exchanges the code, upserts an org-owned connection, and redirects to the secretary integrations tab', async () => {
    const state = signedState({ provider: 'google_sheets', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('google_sheets', { code: 'auth-code-1', state })

    expect(exchangeGoogleSheetsCodeMock).toHaveBeenCalledWith('auth-code-1')
    expect(fromMock).toHaveBeenCalledWith('integration_connections')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google_sheets',
        owner_type: 'org',
        owner_id: ORG_ID,
        org_id: ORG_ID,
        // contract: 平文列には実値を書かず、暗号化列にだけ入れる。
        access_token: '',
        access_token_encrypted: 'enc(access-abc)',
        refresh_token_encrypted: 'enc(refresh-abc)',
        token_expires_at: '2026-07-12T01:00:00.000Z',
        scopes: 'https://www.googleapis.com/auth/spreadsheets',
        status: 'active',
        metadata: {},
      }),
      { onConflict: 'provider,owner_type,owner_id' },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      `https://app.example.com/${ORG_ID}/secretary/integrations?integration=google_sheets&status=connected`,
    )
  })

  // レビュー回帰(Minor): refreshTokenがnullのとき、upsertペイロードにrefresh_tokenキーを
  // 含めてしまうと、既存接続の再認可(reconnect)で保持していたrefresh_tokenをnullで
  // 上書きしてしまう。省略すればon conflict時に既存値が保持される。
  it('omits refresh_token from the upsert payload when Google omits it, so a reconnect does not null out an existing refresh_token', async () => {
    exchangeGoogleSheetsCodeMock.mockResolvedValue({
      accessToken: 'access-abc',
      refreshToken: null,
      expiresAt: new Date('2026-07-12T01:00:00.000Z'),
      scopes: 'https://www.googleapis.com/auth/spreadsheets',
    })
    const state = signedState({ provider: 'google_sheets', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('google_sheets', { code: 'auth-code-1', state })

    const upsertPayload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(upsertPayload).not.toHaveProperty('refresh_token')
    expect(upsertPayload).not.toHaveProperty('refresh_token_encrypted')
    expect(upsertMock).toHaveBeenCalledWith(
      // contract: 平文は空文字、正本は暗号化列。
      expect.objectContaining({ access_token: '', access_token_encrypted: 'enc(access-abc)' }),
      { onConflict: 'provider,owner_type,owner_id' },
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('status=connected')
  })

  it('redirects with status=error when the token exchange fails', async () => {
    exchangeGoogleSheetsCodeMock.mockRejectedValue(new Error('Google Sheets token exchange failed (400)'))
    const state = signedState({ provider: 'google_sheets', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('google_sheets', { code: 'bad-code', state })

    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain(`/${ORG_ID}/secretary/integrations`)
    expect(location).toContain('status=error')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('redirects with status=error when the upsert fails', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'db error' } })
    const state = signedState({ provider: 'google_sheets', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('google_sheets', { code: 'auth-code-1', state })

    const location = response.headers.get('location') ?? ''
    expect(location).toContain(`/${ORG_ID}/secretary/integrations`)
    expect(location).toContain('status=error')
  })

  it('rejects an invalid signed state before exchanging any code', async () => {
    const response = await callGet('google_sheets', { code: 'auth-code-1', state: 'tampered' })
    expect(exchangeGoogleSheetsCodeMock).not.toHaveBeenCalled()
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=invalid_state')
  })
})
