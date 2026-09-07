import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}))

let cookieJar: Record<string, string> = {}
vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => (cookieJar[name] !== undefined ? { name, value: cookieJar[name] } : undefined),
    })
  ),
}))

const mockAfter = vi.fn((task: () => unknown) => task())
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (task: () => unknown) => mockAfter(task) }
})

const mockCheckRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

const mockRecordDeviceLogin = vi.fn()
const mockNotifyNewDevice = vi.fn()
const mockGenerateDeviceId = vi.fn()
vi.mock('@/lib/auth/loginNotify', () => ({
  generateDeviceId: (...args: unknown[]) => mockGenerateDeviceId(...args),
  recordDeviceLogin: (...args: unknown[]) => mockRecordDeviceLogin(...args),
  notifyNewDevice: (...args: unknown[]) => mockNotifyNewDevice(...args),
}))

vi.mock('@/lib/auth/deviceCookie', () => ({
  DEVICE_COOKIE_NAME: 'agentpm_device',
  DEVICE_ID_RE: /^[0-9a-f]{64}$/,
  deviceCookieOptions: () => ({ httpOnly: true, secure: false, sameSite: 'lax' as const, path: '/', maxAge: 1000 }),
}))

const { POST } = await import('@/app/api/auth/login-notify/route')

const VALID_DEVICE_ID = 'a'.repeat(64)

function makeRequest(userAgent?: string): NextRequest {
  return new NextRequest('http://localhost:4000/api/auth/login-notify', {
    method: 'POST',
    headers: userAgent ? { 'user-agent': userAgent } : undefined,
  })
}

describe('POST /api/auth/login-notify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookieJar = {}
    mockGenerateDeviceId.mockReturnValue('b'.repeat(64))
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 1000 })
    mockRecordDeviceLogin.mockResolvedValue({ isNew: false })
    mockNotifyNewDevice.mockResolvedValue(undefined)
  })

  it('未ログインは401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await POST(makeRequest())

    expect(response.status).toBe(401)
    expect(mockRecordDeviceLogin).not.toHaveBeenCalled()
  })

  it('レート制限超過は429で記録もしない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.co.jp' } } })
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 })

    const response = await POST(makeRequest())

    expect(response.status).toBe(429)
    expect(mockRecordDeviceLogin).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).toHaveBeenCalledWith('login-notify:user-1', { maxRequests: 5, windowMs: 10 * 60 * 1000 })
  })

  it('cookieが無ければ新規発行してSet-Cookieする。新規端末なら notified:true・通知は after() 経由', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.co.jp' } } })
    mockRecordDeviceLogin.mockResolvedValue({ isNew: true })

    const response = await POST(makeRequest('Chrome/128 Macintosh'))
    const body = await response.json()

    expect(body).toEqual({ notified: true })
    expect(mockRecordDeviceLogin).toHaveBeenCalledWith({
      userId: 'user-1',
      deviceId: 'b'.repeat(64),
      userAgent: 'Chrome/128 Macintosh',
    })
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockNotifyNewDevice).toHaveBeenCalledWith({ email: 'user@example.co.jp', userAgent: 'Chrome/128 Macintosh' })
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain(`agentpm_device=${'b'.repeat(64)}`)
  })

  it('既存cookieが正しい形式ならそれを使い、Set-Cookieしない。既知端末なら notified:false・通知しない', async () => {
    cookieJar['agentpm_device'] = VALID_DEVICE_ID
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.co.jp' } } })
    mockRecordDeviceLogin.mockResolvedValue({ isNew: false })

    const response = await POST(makeRequest())
    const body = await response.json()

    expect(body).toEqual({ notified: false })
    expect(mockRecordDeviceLogin).toHaveBeenCalledWith(expect.objectContaining({ deviceId: VALID_DEVICE_ID }))
    expect(mockGenerateDeviceId).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockNotifyNewDevice).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('cookieの形式が壊れていれば無かったものとして新規発行する', async () => {
    cookieJar['agentpm_device'] = 'not-a-valid-device-id'
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.co.jp' } } })

    const response = await POST(makeRequest())

    expect(mockGenerateDeviceId).toHaveBeenCalled()
    expect(mockRecordDeviceLogin).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'b'.repeat(64) }))
    expect(response.headers.get('set-cookie')).toContain(`agentpm_device=${'b'.repeat(64)}`)
  })
})
