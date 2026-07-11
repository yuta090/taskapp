import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/integrations/auth/notion?orgId=...
 * 既存のgoogle_calendar/zoom/teamsと同じOAuth開始パターン(signed state→redirect)に
 * provider='notion'分岐を追加したもの。org membershipチェックは既存ロジックを流用。
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

const isNotionOAuthConfiguredMock = vi.fn()
const getNotionOAuthUrlMock = vi.fn()
vi.mock('@/lib/notion/config', () => ({
  isNotionOAuthConfigured: () => isNotionOAuthConfiguredMock(),
  getNotionOAuthUrl: (state: string) => getNotionOAuthUrlMock(state),
}))

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
  isNotionOAuthConfiguredMock.mockReturnValue(true)
  getNotionOAuthUrlMock.mockReturnValue('https://api.notion.com/v1/oauth/authorize?client_id=x')
})

describe('GET /api/integrations/auth/notion', () => {
  it('401 when not logged in', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callGet('notion', ORG_ID)
    expect(response.status).toBe(401)
  })

  it('400 when orgId is missing', async () => {
    const response = await callGet('notion')
    expect(response.status).toBe(400)
  })

  it('403 when the user is not a member of the org', async () => {
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const response = await callGet('notion', ORG_ID)
    expect(response.status).toBe(403)
  })

  it('503 when Notion OAuth is not configured', async () => {
    isNotionOAuthConfiguredMock.mockReturnValue(false)
    const response = await callGet('notion', ORG_ID)
    expect(response.status).toBe(503)
  })

  it('redirects to the Notion authorize URL with a signed state', async () => {
    const response = await callGet('notion', ORG_ID)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://api.notion.com/v1/oauth/authorize?client_id=x')
    expect(getNotionOAuthUrlMock).toHaveBeenCalledTimes(1)
    expect(typeof getNotionOAuthUrlMock.mock.calls[0][0]).toBe('string')
  })
})
