import { TEAMS_CONFIG, TEAMS_SCOPES } from './config'

interface TeamsTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

/**
 * 認可コードをトークンに交換
 */
export async function exchangeTeamsCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string
}> {
  const redirectUri =
    process.env.MS_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/teams`

  const tokenUrl = `https://login.microsoftonline.com/${TEAMS_CONFIG.tenantId}/oauth2/v2.0/token`

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TEAMS_CONFIG.clientId,
      client_secret: TEAMS_CONFIG.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      scope: TEAMS_SCOPES,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Teams token exchange failed:', response.status, errorBody)
    throw new Error(`Teams token exchange failed (${response.status})`)
  }

  const data: TeamsTokenResponse = await response.json()
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
export async function refreshTeamsToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
}> {
  const tokenUrl = `https://login.microsoftonline.com/${TEAMS_CONFIG.tenantId}/oauth2/v2.0/token`

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TEAMS_CONFIG.clientId,
      client_secret: TEAMS_CONFIG.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: TEAMS_SCOPES,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Teams token refresh failed:', response.status, errorBody)
    throw new Error(`Teams token refresh failed (${response.status})`)
  }

  const data: TeamsTokenResponse = await response.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  }
}
