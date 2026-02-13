import { GOOGLE_CALENDAR_CONFIG } from './config'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

/**
 * 認可コードをトークンに交換
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string
}> {
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/google_calendar`

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CALENDAR_CONFIG.clientId,
      client_secret: GOOGLE_CALENDAR_CONFIG.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Google token exchange failed:', response.status, errorBody)
    throw new Error(`Google token exchange failed (${response.status})`)
  }

  const data: GoogleTokenResponse = await response.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    scopes: data.scope,
  }
}

/**
 * リフレッシュトークンでアクセストークンを更新
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken?: string | null
  expiresAt: Date | null
}> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CALENDAR_CONFIG.clientId,
      client_secret: GOOGLE_CALENDAR_CONFIG.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Google token refresh failed:', response.status, errorBody)
    throw new Error(`Google token refresh failed (${response.status})`)
  }

  const data: GoogleTokenResponse = await response.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  }
}

/**
 * Google OAuth トークンを無効化
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  const response = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  return response.ok
}

/**
 * Google Calendar API クライアントクラス
 */
export class GoogleCalendarClient {
  private accessToken: string
  private baseUrl = 'https://www.googleapis.com/calendar/v3'

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Google Calendar API error:', response.status, errorBody)
      throw new Error(`Google Calendar API error (${response.status})`)
    }

    return response.json()
  }

  /**
   * Free/Busy 問い合わせ
   */
  async queryFreeBusy(params: {
    timeMin: string
    timeMax: string
    items: Array<{ id: string }>
  }): Promise<{
    calendars: Record<string, {
      busy: Array<{ start: string; end: string }>
      errors?: Array<{ domain: string; reason: string }>
    }>
  }> {
    return this.request('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        items: params.items,
      }),
    })
  }
}
