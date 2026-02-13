export const ZOOM_CONFIG = {
  clientId: process.env.ZOOM_CLIENT_ID || '',
  clientSecret: process.env.ZOOM_CLIENT_SECRET || '',
}

export const ZOOM_SCOPES = 'meeting:write'

const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/authorize'

/**
 * Zoom 連携が有効かチェック（サーバー/クライアント両方で安全）
 */
export function isZoomConfigured(): boolean {
  return process.env.NEXT_PUBLIC_ZOOM_ENABLED === 'true'
}

/**
 * Zoom OAuth設定が完全かチェック（サーバーサイドのみ）
 */
export function isZoomOAuthConfigured(): boolean {
  return !!(ZOOM_CONFIG.clientId && ZOOM_CONFIG.clientSecret)
}

/**
 * Zoom OAuth認証URLを生成
 */
export function getZoomOAuthUrl(state: string): string {
  const redirectUri =
    process.env.ZOOM_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/zoom`

  const params = new URLSearchParams({
    client_id: ZOOM_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  })

  return `${ZOOM_OAUTH_URL}?${params.toString()}`
}
