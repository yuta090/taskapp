import { GOOGLE_SHEETS_CONFIG, getGoogleSheetsRedirectUri } from './config'
import { refreshAccessToken } from '@/lib/google-calendar/client'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/**
 * refreshは既存のgoogle-calendar/client.tsのrefreshAccessTokenをそのまま再利用する
 * (token endpointのrefreshはredirect_uriに依存しないため、sheets専用に複製する必要がない)。
 */
export { refreshAccessToken }

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

/**
 * 認可コードをトークンに交換。google-calendar/client.tsのexchangeCodeForTokensと同形だが、
 * redirect_uriがgoogle_sheets用コールバックである点だけが異なる。
 * トークンはログ出力しない（エラー時もstatusとレスポンスbodyのみ出す）。
 */
export async function exchangeGoogleSheetsCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string
}> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_SHEETS_CONFIG.clientId,
      client_secret: GOOGLE_SHEETS_CONFIG.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: getGoogleSheetsRedirectUri(),
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Google Sheets token exchange failed:', response.status, errorBody)
    throw new Error(`Google Sheets token exchange failed (${response.status})`)
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
