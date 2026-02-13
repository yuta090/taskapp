import { ZOOM_CONFIG } from './config'

const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token'

interface ZoomTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope: string
}

/**
 * 認可コードをトークンに交換
 * Zoom は Basic 認証 (base64(client_id:client_secret)) を使用
 */
export async function exchangeZoomCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string
}> {
  const redirectUri =
    process.env.ZOOM_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/zoom`

  const credentials = Buffer.from(
    `${ZOOM_CONFIG.clientId}:${ZOOM_CONFIG.clientSecret}`,
  ).toString('base64')

  const response = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Zoom token exchange failed:', response.status, errorBody)
    throw new Error(`Zoom token exchange failed (${response.status})`)
  }

  const data: ZoomTokenResponse = await response.json()
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
export async function refreshZoomToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
}> {
  const credentials = Buffer.from(
    `${ZOOM_CONFIG.clientId}:${ZOOM_CONFIG.clientSecret}`,
  ).toString('base64')

  const response = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Zoom token refresh failed:', response.status, errorBody)
    throw new Error(`Zoom token refresh failed (${response.status})`)
  }

  const data: ZoomTokenResponse = await response.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  }
}
