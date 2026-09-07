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

const mockRecordAuthFailure = vi.fn()
vi.mock('@/lib/auth/authEventLog', () => ({
  recordAuthFailure: (...args: unknown[]) => mockRecordAuthFailure(...args),
}))

const mockRecordLoginAndNotify = vi.fn()
const mockGenerateDeviceId = vi.fn()
vi.mock('@/lib/auth/loginNotify', () => ({
  DEVICE_COOKIE_NAME: 'agentpm_device',
  deviceCookieOptions: () => ({ httpOnly: true, secure: false, sameSite: 'lax' as const, path: '/', maxAge: 1000 }),
  generateDeviceId: (...args: unknown[]) => mockGenerateDeviceId(...args),
  recordLoginAndNotify: (...args: unknown[]) => mockRecordLoginAndNotify(...args),
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
    mockRecordAuthFailure.mockResolvedValue(undefined)
    mockRecordLoginAndNotify.mockResolvedValue({ notified: false })
    mockGenerateDeviceId.mockReturnValue('new-device-id')
  })

  it('code が無ければログインへ（失敗扱い・理由を残す）', async () => {
    const response = await GET(makeRequest('/auth/callback'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed&reason=missing_code')
    expect(mockRecordAuthFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: 'missing_code' }))
  })

  it('ユーザーが Google 画面で取り消したら（access_denied）キャンセル表示', async () => {
    const response = await GET(makeRequest('/auth/callback?error=access_denied'))

    expect(redirectPath(response)).toBe('/login?error=auth_cancelled&reason=access_denied')
    expect(mockRecordAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'provider_callback', errorCode: 'access_denied' })
    )
  })

  it('Supabase側の失敗（合鍵違い等）はキャンセルではなくプロバイダエラーとして理由を残す', async () => {
    const response = await GET(
      makeRequest(
        '/auth/callback?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code'
      )
    )

    expect(redirectPath(response)).toBe('/login?error=auth_provider_error&reason=unexpected_failure')
    expect(mockRecordAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'provider_callback',
        provider: 'google',
        errorCode: 'unexpected_failure',
        errorDescription: 'Unable to exchange external code',
        metadata: expect.objectContaining({ error: 'server_error' }),
      })
    )
  })

  it('コード交換に失敗すればログインへ（fail-closed・Supabaseのエラー内容を記録）', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: 'invalid flow state', code: 'flow_state_not_found', status: 404 },
    })

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed&reason=exchange_failed')
    expect(mockRecordAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'code_exchange',
        errorCode: 'flow_state_not_found',
        errorDescription: 'invalid flow state',
        metadata: expect.objectContaining({ status: 404 }),
      })
    )
  })

  it('ユーザー取得に失敗すればログインへ（fail-closed）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed&reason=no_user')
    expect(mockRecordAuthFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: 'session_user' }))
  })

  it('着地判定に失敗すればログインへ（fail-closed・ユーザーIDを添えて記録）', async () => {
    mockResolvePostLoginLanding.mockRejectedValue(new Error('membership query failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed&reason=landing_failed')
    expect(mockRecordAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'landing', userId: 'user-1', errorDescription: 'membership query failed' })
    )
  })

  it('成功時は失敗ログを書かない', async () => {
    mockResolvePostLoginLanding.mockResolvedValue('/inbox')

    await GET(makeRequest('/auth/callback?code=abc'))

    expect(mockRecordAuthFailure).not.toHaveBeenCalled()
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

    expect(redirectPath(response)).toBe('/login?error=auth_callback_failed&reason=landing_failed')
  })

  it('なりすましログイン対策: ユーザー確定後に recordLoginAndNotify を呼ぶ（UA・cookieのdevice_id込み）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } } })
    mockResolvePostLoginLanding.mockResolvedValue('/inbox')

    await GET(
      new NextRequest('http://localhost:4000/auth/callback?code=abc', {
        headers: { cookie: 'agentpm_device=existing-device-id', 'user-agent': 'Chrome/128 Macintosh' },
      })
    )

    expect(mockRecordLoginAndNotify).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@example.com',
      deviceId: 'existing-device-id',
      userAgent: 'Chrome/128 Macintosh',
    })
    expect(mockGenerateDeviceId).not.toHaveBeenCalled()
  })

  it('device cookieが無ければ新規発行し、成功時のリダイレクトにSet-Cookieする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } } })
    mockResolvePostLoginLanding.mockResolvedValue('/inbox')

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(mockRecordLoginAndNotify).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'new-device-id' })
    )
    expect(response.headers.get('set-cookie')).toContain('agentpm_device=new-device-id')
  })

  it('next パラメータへの復帰でも Set-Cookie する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } } })

    const response = await GET(makeRequest('/auth/callback?code=abc&next=%2Finvite%2Ftok-1'))

    expect(response.headers.get('set-cookie')).toContain('agentpm_device=new-device-id')
  })

  it('着地判定に失敗した失敗リダイレクトには device cookie を付けない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } } })
    mockResolvePostLoginLanding.mockRejectedValue(new Error('boom'))

    const response = await GET(makeRequest('/auth/callback?code=abc'))

    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
