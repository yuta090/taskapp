export const TEAMS_CONFIG = {
  clientId: process.env.MS_CLIENT_ID || '',
  clientSecret: process.env.MS_CLIENT_SECRET || '',
  tenantId: process.env.MS_TENANT_ID || '',
}

export const TEAMS_SCOPES = 'OnlineMeetings.ReadWrite offline_access'

/**
 * Teams 連携が有効かチェック（サーバー/クライアント両方で安全）
 */
export function isTeamsConfigured(): boolean {
  return process.env.NEXT_PUBLIC_TEAMS_ENABLED === 'true'
}

/**
 * Teams OAuth設定が完全かチェック（サーバーサイドのみ）
 */
export function isTeamsOAuthConfigured(): boolean {
  return !!(
    TEAMS_CONFIG.clientId &&
    TEAMS_CONFIG.clientSecret &&
    TEAMS_CONFIG.tenantId
  )
}

/**
 * Microsoft Teams OAuth認証URLを生成
 */
export function getTeamsOAuthUrl(state: string): string {
  const redirectUri =
    process.env.MS_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/teams`

  const params = new URLSearchParams({
    client_id: TEAMS_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: TEAMS_SCOPES,
    state,
    response_mode: 'query',
  })

  return `https://login.microsoftonline.com/${TEAMS_CONFIG.tenantId}/oauth2/v2.0/authorize?${params.toString()}`
}
