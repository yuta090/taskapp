import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

/**
 * GET /api/integrations/callback/{google_calendar|zoom|teams}
 *
 * 回帰: 2026-09-06 に本番で「カレンダー/ビデオ会議を接続すると save_failed でトップに戻される」。
 * 原因は upsert(onConflict:'provider,owner_type,owner_id') が式付き一意キーに合わず Postgres に
 * 拒否されていたこと。保存は saveOAuthConnection（select→update/insert）経由に固定する。
 */

const getUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) },  getUser: getUserMock } })),
}))

const saveMock = vi.fn()
vi.mock('@/lib/integrations/connection-store', () => ({
  saveOAuthConnection: (...args: unknown[]) => saveMock(...args),
}))

const upsertMock = vi.fn()
const fromMock = vi.fn(() => ({ upsert: upsertMock }))
const rpcMock = vi.fn((fn: string, args: Record<string, string>) => {
  if (fn === 'encrypt_system_secret') return Promise.resolve({ data: `enc(${args.plaintext})`, error: null })
  return Promise.reject(new Error(`unexpected rpc: ${fn}`))
})
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const exchangeCodeForTokensMock = vi.fn()
const exchangeZoomCodeMock = vi.fn()
const exchangeTeamsCodeMock = vi.fn()
vi.mock('@/lib/google-calendar/client', () => ({ exchangeCodeForTokens: (...a: unknown[]) => exchangeCodeForTokensMock(...a) }))
vi.mock('@/lib/zoom/client', () => ({ exchangeZoomCode: (...a: unknown[]) => exchangeZoomCodeMock(...a) }))
vi.mock('@/lib/teams/client', () => ({ exchangeTeamsCode: (...a: unknown[]) => exchangeTeamsCodeMock(...a) }))
vi.mock('@/lib/notion/client', () => ({ exchangeNotionCode: vi.fn() }))
vi.mock('@/lib/google-sheets/client', () => ({ exchangeGoogleSheetsCode: vi.fn() }))
vi.mock('@/lib/google-tasks/client', () => ({ exchangeGoogleTasksCode: vi.fn() }))

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

const TOKENS = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-abc',
  expiresAt: new Date('2026-09-06T01:00:00.000Z'),
  scopes: 'scope-a',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OAUTH_STATE_SECRET = STATE_SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  saveMock.mockResolvedValue({ data: { id: 'conn-1' }, error: null })
  exchangeCodeForTokensMock.mockResolvedValue(TOKENS)
  exchangeZoomCodeMock.mockResolvedValue(TOKENS)
  exchangeTeamsCodeMock.mockResolvedValue(TOKENS)
})

describe.each([
  ['google_calendar', () => exchangeCodeForTokensMock],
  ['zoom', () => exchangeZoomCodeMock],
  ['teams', () => exchangeTeamsCodeMock],
] as const)('GET /api/integrations/callback/%s', (provider, exchange) => {
  it('user 単位で saveOAuthConnection に保存し、settings/integrations に status=connected で戻る', async () => {
    const state = signedState({ provider, orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet(provider, { code: 'auth-code-1', state })

    expect(exchange()).toHaveBeenCalledWith('auth-code-1')
    expect(saveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider,
        owner_type: 'user',
        owner_id: USER_ID,
        org_id: ORG_ID,
        access_token: '',
        access_token_encrypted: 'enc(access-abc)',
        refresh_token_encrypted: 'enc(refresh-abc)',
        status: 'active',
      }),
    )
    // 壊れていた upsert(onConflict) 経路は通らない
    expect(upsertMock).not.toHaveBeenCalled()
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      `https://app.example.com/settings/integrations?integration=${provider}&status=connected`,
    )
  })

  it('保存に失敗したら save_failed で戻る（トークン交換は済んでいる）', async () => {
    saveMock.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const state = signedState({ provider, orgId: ORG_ID, userId: USER_ID, ts: Date.now() })
    const response = await callGet(provider, { code: 'auth-code-1', state })
    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('status=error')
    expect(location).toContain('message=save_failed')
  })
})
