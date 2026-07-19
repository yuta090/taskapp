import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

/**
 * GET /api/integrations/callback/google_tasks?code=...&state=...
 * handleGoogleTasksCallback: トークン交換→**owner_type='user'**でupsert→settings/integrations へ
 * リダイレクト(google_calendar と同じ user 単位・同じタブ)。トークンは暗号化列にも入る。
 */

const getUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))

// 接続保存は upsert().select('id').single() で id を取得する(backfill 呼び出しに使う)。
const singleMock = vi.fn()
const upsertMock = vi.fn((..._args: unknown[]) => ({ select: () => ({ single: singleMock }) }))
const fromMock = vi.fn(() => ({ upsert: upsertMock }))
const rpcMock = vi.fn((fn: string, args: Record<string, string>) => {
  if (fn === 'encrypt_system_secret') return Promise.resolve({ data: `enc(${args.plaintext})`, error: null })
  if (fn === 'rpc_backfill_task_mirror') return Promise.resolve({ data: 2, error: null })
  return Promise.reject(new Error(`unexpected rpc: ${fn}`))
})
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const exchangeGoogleTasksCodeMock = vi.fn()
vi.mock('@/lib/google-tasks/client', () => ({
  exchangeGoogleTasksCode: (...args: unknown[]) => exchangeGoogleTasksCodeMock(...args),
}))

// 他providerのハンドラは対象外なのでstub
vi.mock('@/lib/google-calendar/client', () => ({ exchangeCodeForTokens: vi.fn() }))
vi.mock('@/lib/zoom/client', () => ({ exchangeZoomCode: vi.fn() }))
vi.mock('@/lib/teams/client', () => ({ exchangeTeamsCode: vi.fn() }))
vi.mock('@/lib/notion/client', () => ({ exchangeNotionCode: vi.fn() }))
vi.mock('@/lib/google-sheets/client', () => ({ exchangeGoogleSheetsCode: vi.fn() }))

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
  return GET(new NextRequest(url), { params: Promise.resolve({ provider }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OAUTH_STATE_SECRET = STATE_SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  singleMock.mockResolvedValue({ data: { id: 'conn-new' }, error: null })
  exchangeGoogleTasksCodeMock.mockResolvedValue({
    accessToken: 'access-abc',
    refreshToken: 'refresh-abc',
    expiresAt: new Date('2026-07-20T01:00:00.000Z'),
    scopes: 'https://www.googleapis.com/auth/tasks',
  })
})

describe('GET /api/integrations/callback/google_tasks', () => {
  it('コード交換→user単位でupsert(トークンは暗号化列にも入る)→settings/integrationsへ', async () => {
    const state = signedState({ provider: 'google_tasks', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('google_tasks', { code: 'auth-code-1', state })

    expect(exchangeGoogleTasksCodeMock).toHaveBeenCalledWith('auth-code-1')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google_tasks',
        owner_type: 'user',
        owner_id: USER_ID,
        org_id: ORG_ID,
        access_token: 'access-abc',
        access_token_encrypted: 'enc(access-abc)',
        refresh_token: 'refresh-abc',
        refresh_token_encrypted: 'enc(refresh-abc)',
        token_expires_at: '2026-07-20T01:00:00.000Z',
        scopes: 'https://www.googleapis.com/auth/tasks',
        status: 'active',
        metadata: {},
      }),
      { onConflict: 'provider,owner_type,owner_id' },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://app.example.com/settings/integrations?integration=google_tasks&status=connected',
    )
  })

  it('refresh_tokenがnullなら省略する(再認可で既存を潰さない)', async () => {
    exchangeGoogleTasksCodeMock.mockResolvedValue({
      accessToken: 'access-abc',
      refreshToken: null,
      expiresAt: new Date('2026-07-20T01:00:00.000Z'),
      scopes: 'https://www.googleapis.com/auth/tasks',
    })
    const state = signedState({ provider: 'google_tasks', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    await callGet('google_tasks', { code: 'auth-code-1', state })

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('refresh_token')
    expect(payload).not.toHaveProperty('refresh_token_encrypted')
  })

  it('トークン交換失敗でstatus=errorにリダイレクトしupsertしない', async () => {
    exchangeGoogleTasksCodeMock.mockRejectedValue(new Error('token exchange failed (400)'))
    const state = signedState({ provider: 'google_tasks', orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet('google_tasks', { code: 'bad', state })

    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/settings/integrations')
    expect(location).toContain('status=error')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('署名不正なstateはコード交換前に弾く', async () => {
    const response = await callGet('google_tasks', { code: 'auth-code-1', state: 'tampered' })
    expect(exchangeGoogleTasksCodeMock).not.toHaveBeenCalled()
    expect(response.headers.get('location') ?? '').toContain('error=invalid_state')
  })
})
