import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/integrations/auth/google_sheets?orgId=...
 * notionと同じOAuth開始パターン(signed state→redirect)にprovider='google_sheets'分岐を追加したもの。
 * org共有provider(ORG_OWNED_PROVIDERS)としてowner/admin限定である点もnotionと同じ。
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

const isGoogleSheetsOAuthConfiguredMock = vi.fn()
const getGoogleSheetsOAuthUrlMock = vi.fn()
vi.mock('@/lib/google-sheets/config', () => ({
  isGoogleSheetsOAuthConfigured: () => isGoogleSheetsOAuthConfiguredMock(),
  getGoogleSheetsOAuthUrl: (state: string) => getGoogleSheetsOAuthUrlMock(state),
}))

// 他providerのハンドラは今回のテスト対象外なのでimportエラーにならないようスタブする
vi.mock('@/lib/google-calendar/config', () => ({
  isGoogleCalendarFullyConfigured: vi.fn(() => true),
  getGoogleOAuthUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x'),
}))
vi.mock('@/lib/zoom/config', () => ({ isZoomOAuthConfigured: vi.fn(), getZoomOAuthUrl: vi.fn() }))
vi.mock('@/lib/teams/config', () => ({ isTeamsOAuthConfigured: vi.fn(), getTeamsOAuthUrl: vi.fn() }))
vi.mock('@/lib/notion/config', () => ({ isNotionOAuthConfigured: vi.fn(), getNotionOAuthUrl: vi.fn() }))

const { GET } = await import('@/app/api/integrations/auth/[provider]/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function callGet(provider: string, orgId?: string) {
  const url = orgId
    ? `http://localhost:3000/api/integrations/auth/${provider}?orgId=${orgId}`
    : `http://localhost:3000/api/integrations/auth/${provider}`
  const request = new NextRequest(url)
  return GET(request, { params: Promise.resolve({ provider }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OAUTH_STATE_SECRET = 'test-state-secret'
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  isGoogleSheetsOAuthConfiguredMock.mockReturnValue(true)
  getGoogleSheetsOAuthUrlMock.mockReturnValue(
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=spreadsheets',
  )
})

describe('GET /api/integrations/auth/google_sheets', () => {
  it('401 when not logged in', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callGet('google_sheets', ORG_ID)
    expect(response.status).toBe(401)
  })

  it('403 when the user is not a member of the org', async () => {
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const response = await callGet('google_sheets', ORG_ID)
    expect(response.status).toBe(403)
  })

  it('503 when Google Sheets OAuth is not configured', async () => {
    isGoogleSheetsOAuthConfiguredMock.mockReturnValue(false)
    const response = await callGet('google_sheets', ORG_ID)
    expect(response.status).toBe(503)
  })

  it('redirects to the Google authorize URL with a signed state', async () => {
    const response = await callGet('google_sheets', ORG_ID)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=spreadsheets',
    )
    expect(getGoogleSheetsOAuthUrlMock).toHaveBeenCalledTimes(1)
    expect(typeof getGoogleSheetsOAuthUrlMock.mock.calls[0][0]).toBe('string')
  })

  // org共有provider(notion/google_sheets)のOAuth開始はowner/admin限定(既存ゲートがgoogle_sheetsにも
  // 効くこと)。memberが実行できると、callbackのorg-scoped upsertで全google_sheets sinkの配達先が
  // 自分のトークンに差し替わってしまう。
  it('403 for a member (not owner/admin) starting Google Sheets OAuth (org-owned provider gate)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callGet('google_sheets', ORG_ID)
    expect(response.status).toBe(403)
    expect(getGoogleSheetsOAuthUrlMock).not.toHaveBeenCalled()
  })

  it('redirects for an admin role (not just owner)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    const response = await callGet('google_sheets', ORG_ID)
    expect(response.status).toBe(307)
  })
})
