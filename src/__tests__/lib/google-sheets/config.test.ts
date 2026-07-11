import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Google Sheets OAuth設定 — 既存のGoogle Calendar OAuth基盤(GOOGLE_CLIENT_ID/SECRET)を再利用し、
 * scopeをspreadsheetsのみに絞ったURLを生成する(AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3 Google Sheets)。
 *
 * GOOGLE_SHEETS_CONFIGはモジュール読み込み時にprocess.envを読むため、env違いのケースごとに
 * vi.resetModules()で再importする(notion/config.tsと同じ構造)。
 */

beforeEach(() => {
  vi.resetModules()
  process.env.GOOGLE_CLIENT_ID = 'client-id-1'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret-1'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

describe('isGoogleSheetsOAuthConfigured', () => {
  it('true when both client id and secret are set', async () => {
    const { isGoogleSheetsOAuthConfigured } = await import('@/lib/google-sheets/config')
    expect(isGoogleSheetsOAuthConfigured()).toBe(true)
  })

  it('false when client secret is missing', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET
    const { isGoogleSheetsOAuthConfigured } = await import('@/lib/google-sheets/config')
    expect(isGoogleSheetsOAuthConfigured()).toBe(false)
  })
})

describe('getGoogleSheetsOAuthUrl', () => {
  it('builds an authorize URL scoped to spreadsheets only, with offline access and consent prompt', async () => {
    const { getGoogleSheetsOAuthUrl } = await import('@/lib/google-sheets/config')
    const url = new URL(getGoogleSheetsOAuthUrl('state-123'))

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('client-id-1')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/integrations/callback/google_sheets',
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/spreadsheets')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('state')).toBe('state-123')
  })
})
