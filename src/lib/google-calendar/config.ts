export const GOOGLE_CALENDAR_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  stateSecret: process.env.GOOGLE_STATE_SECRET || '',
}

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
]

const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * Google Calendar 連携が有効かチェック（サーバー/クライアント両方で安全）
 */
export function isGoogleCalendarConfigured(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED === 'true'
}

/**
 * Google Calendar OAuth設定が完全かチェック（サーバーサイドのみ）
 */
export function isGoogleCalendarFullyConfigured(): boolean {
  return !!(
    GOOGLE_CALENDAR_CONFIG.clientId &&
    GOOGLE_CALENDAR_CONFIG.clientSecret &&
    GOOGLE_CALENDAR_CONFIG.stateSecret
  )
}

/**
 * Google OAuth認証URLを生成
 */
export function getGoogleOAuthUrl(state: string): string {
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/google_calendar`

  const params = new URLSearchParams({
    client_id: GOOGLE_CALENDAR_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  })

  return `${GOOGLE_OAUTH_URL}?${params.toString()}`
}
