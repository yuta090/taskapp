import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/auth/callback/route'

const mockExchangeCodeForSession = vi.fn()
const mockGetUser = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      getUser: mockGetUser,
    },
  }),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      getAll: () => [],
      set: vi.fn(),
    })
  ),
}))

const mockResolvePostLoginLanding = vi.fn()
vi.mock('@/lib/auth/resolveLanding', () => ({
  resolvePostLoginLanding: (...args: unknown[]) => mockResolvePostLoginLanding(...args),
}))

function makeRequest(path: string, cookieHeader?: string): NextRequest {
  return new NextRequest(
    `http://localhost:4000${path}`,
    cookieHeader ? { headers: { cookie: cookieHeader } } : undefined
  )
}

function redirectPath(response: Response): string | null {
  const location = response.headers.get('location')
  if (!location) return null
  const url = new URL(location)
  return url.pathname + url.search
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('code が無ければログインへ（失敗扱い）', async () => {
    const response = await GET(makeRequest('/auth/callback'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed')
  })

  it('Google認証がキャンセルされればログインへ', async () => {
    const response = await GET(makeRequest('/auth/callback?error=access_denied'))

    expect(redirectPath(response)).toBe('/login?error=auth_cancelled')
  })

  it('コード交換に失敗すればログインへ（fail-closed）', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: { message: 'x' } })

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed')
  })

  it('ユーザー取得に失敗すればログインへ（fail-closed）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed')
  })

  it('vendorロールなら /vendor-portal へ（ベンダーのGoogleログインが/portalで行き止まりにならない）', async () => {
    mockResolvePostLoginLanding.mockResolvedValue('/vendor-portal')

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/vendor-portal')
  })

  it('clientロール(vendor以外)は /portal へ', async () => {
    mockResolvePostLoginLanding.mockResolvedValue('/portal')

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/portal')
  })

  it('next パラメータがあれば（検証の上）resolvePostLoginLanding より優先してそこへ復帰', async () => {
    const response = await GET(makeRequest('/auth/callback?code=abc&next=%2Finvite%2Ftok-1'))

    expect(redirectPath(response)).toBe('/invite/tok-1')
    expect(mockResolvePostLoginLanding).not.toHaveBeenCalled()
  })

  it('不正な next（// 始まり、オープンリダイレクト対策）は無視して通常の着地判定へ', async () => {
    mockResolvePostLoginLanding.mockResolvedValue('/onboarding')

    const response = await GET(makeRequest('/auth/callback?code=abc&next=%2F%2Fevil.com'))

    expect(redirectPath(response)).toBe('/onboarding')
  })

  it('ACTIVE_ORG_COOKIE を preferredOrgId として resolvePostLoginLanding に渡す（複数org切替中の着地）', async () => {
    mockResolvePostLoginLanding.mockResolvedValue('/org-2/project/space-1')

    await GET(makeRequest('/auth/callback?code=abc', 'taskapp:activeOrgId=org-2'))

    expect(mockResolvePostLoginLanding).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      preferredOrgId: 'org-2',
    })
  })

  it('membershipクエリエラー（resolvePostLoginLandingが例外）は fail-closed でログインへ', async () => {
    mockResolvePostLoginLanding.mockRejectedValue(new Error('boom'))

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed')
  })
})
