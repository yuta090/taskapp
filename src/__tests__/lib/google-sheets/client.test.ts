import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * exchangeGoogleSheetsCode — Google OAuthのトークン交換。google-calendar/client.tsの
 * exchangeCodeForTokensと同形だが、redirect_uriがgoogle_sheets用コールバックになる点だけが異なる
 * (PR-4)。refreshは既存のrefreshAccessToken(google-calendar/client.ts)をそのまま再利用するため
 * ここでは再実装しない。
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_CLIENT_ID = 'client-id-1'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret-1'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

describe('exchangeGoogleSheetsCode', () => {
  it('POSTs to the token endpoint with the google_sheets redirect_uri and returns mapped tokens', async () => {
    const { exchangeGoogleSheetsCode } = await import('@/lib/google-sheets/client')

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-abc',
        refresh_token: 'refresh-abc',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        token_type: 'Bearer',
      }),
    })

    const before = Date.now()
    const tokens = await exchangeGoogleSheetsCode('auth-code-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const body = new URLSearchParams(init.body)
    expect(body.get('client_id')).toBe('client-id-1')
    expect(body.get('client_secret')).toBe('client-secret-1')
    expect(body.get('code')).toBe('auth-code-1')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('redirect_uri')).toBe('https://app.example.com/api/integrations/callback/google_sheets')

    expect(tokens.accessToken).toBe('access-abc')
    expect(tokens.refreshToken).toBe('refresh-abc')
    expect(tokens.scopes).toBe('https://www.googleapis.com/auth/spreadsheets')
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })

  it('returns refreshToken:null when Google omits it (re-consent not forced)', async () => {
    const { exchangeGoogleSheetsCode } = await import('@/lib/google-sheets/client')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-abc',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        token_type: 'Bearer',
      }),
    })

    const tokens = await exchangeGoogleSheetsCode('auth-code-1')
    expect(tokens.refreshToken).toBeNull()
  })

  it('throws with the response status when the exchange fails, without leaking the response body', async () => {
    const { exchangeGoogleSheetsCode } = await import('@/lib/google-sheets/client')
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' })

    await expect(exchangeGoogleSheetsCode('bad-code')).rejects.toThrow(
      'Google Sheets token exchange failed (400)',
    )
  })
})

describe('refreshAccessToken re-export', () => {
  it('re-exports the existing google-calendar refreshAccessToken (redirect_uri independent, safe to share)', async () => {
    const client = await import('@/lib/google-sheets/client')
    const calendarClient = await import('@/lib/google-calendar/client')
    expect(client.refreshAccessToken).toBe(calendarClient.refreshAccessToken)
  })
})
