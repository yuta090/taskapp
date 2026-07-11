/**
 * Google Sheets OAuth設定（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3 Google Sheets / PR-4）。
 * 既存のGoogle OAuth基盤(google-calendar/client.tsのトークン交換・refresh)を再利用しつつ、
 * scopeをspreadsheetsのみに絞ったOAuth開始URLを別途生成する。
 */

export const GOOGLE_SHEETS_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
}

export const GOOGLE_SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * Google Sheets OAuth設定が完全かチェック（サーバーサイドのみ）
 */
export function isGoogleSheetsOAuthConfigured(): boolean {
  return !!(GOOGLE_SHEETS_CONFIG.clientId && GOOGLE_SHEETS_CONFIG.clientSecret)
}

export function getGoogleSheetsRedirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/google_sheets`
}

/**
 * Google Sheets OAuth認証URLを生成
 */
export function getGoogleSheetsOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_SHEETS_CONFIG.clientId,
    redirect_uri: getGoogleSheetsRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SHEETS_SCOPES.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  })

  return `${GOOGLE_OAUTH_URL}?${params.toString()}`
}
