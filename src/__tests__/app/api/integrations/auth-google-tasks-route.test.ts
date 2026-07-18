import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/integrations/auth/google_tasks?orgId=...
 * google_calendar と同じ user 単位接続(個人の Google Tasks は共有不可)。
 * よって org 共有provider(ORG_OWNED_PROVIDERS)ではなく、**member なら誰でも接続開始できる**
 * (google_sheets/notion の owner/admin ゲートは掛からない)。ここが google_sheets との差分。
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

const isGoogleTasksOAuthConfiguredMock = vi.fn()
const getGoogleTasksOAuthUrlMock = vi.fn()
vi.mock('@/lib/google-tasks/config', () => ({
  isGoogleTasksOAuthConfigured: () => isGoogleTasksOAuthConfiguredMock(),
  getGoogleTasksOAuthUrl: (state: string) => getGoogleTasksOAuthUrlMock(state),
}))

// 他providerのハンドラは対象外なのでimportエラー回避のためstub
vi.mock('@/lib/google-calendar/config', () => ({
  isGoogleCalendarFullyConfigured: vi.fn(() => true),
  getGoogleOAuthUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x'),
}))
vi.mock('@/lib/zoom/config', () => ({ isZoomOAuthConfigured: vi.fn(), getZoomOAuthUrl: vi.fn() }))
vi.mock('@/lib/teams/config', () => ({ isTeamsOAuthConfigured: vi.fn(), getTeamsOAuthUrl: vi.fn() }))
vi.mock('@/lib/notion/config', () => ({ isNotionOAuthConfigured: vi.fn(), getNotionOAuthUrl: vi.fn() }))
vi.mock('@/lib/google-sheets/config', () => ({
  isGoogleSheetsOAuthConfigured: vi.fn(),
  getGoogleSheetsOAuthUrl: vi.fn(),
}))

const { GET } = await import('@/app/api/integrations/auth/[provider]/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function callGet(provider: string, orgId?: string) {
  const url = orgId
    ? `http://localhost:3000/api/integrations/auth/${provider}?orgId=${orgId}`
    : `http://localhost:3000/api/integrations/auth/${provider}`
  return GET(new NextRequest(url), { params: Promise.resolve({ provider }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OAUTH_STATE_SECRET = 'test-state-secret'
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
  isGoogleTasksOAuthConfiguredMock.mockReturnValue(true)
  getGoogleTasksOAuthUrlMock.mockReturnValue(
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=tasks',
  )
})

describe('GET /api/integrations/auth/google_tasks', () => {
  it('401 when not logged in', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    expect((await callGet('google_tasks', ORG_ID)).status).toBe(401)
  })

  it('403 when the user is not a member of the org', async () => {
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    expect((await callGet('google_tasks', ORG_ID)).status).toBe(403)
  })

  it('503 when Google Tasks OAuth is not configured', async () => {
    isGoogleTasksOAuthConfiguredMock.mockReturnValue(false)
    expect((await callGet('google_tasks', ORG_ID)).status).toBe(503)
  })

  it('member(owner/adminでなくても)がOAuth開始できる(user単位providerなのでorgゲート無し)', async () => {
    const response = await callGet('google_tasks', ORG_ID)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=tasks',
    )
    expect(getGoogleTasksOAuthUrlMock).toHaveBeenCalledTimes(1)
  })
})
