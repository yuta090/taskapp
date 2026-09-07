import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/login-notify/route'

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

const mockRecordLoginAndNotify = vi.fn()
const mockGenerateDeviceId = vi.fn()
vi.mock('@/lib/auth/loginNotify', () => ({
  DEVICE_COOKIE_NAME: 'agentpm_device',
  deviceCookieOptions: () => ({ httpOnly: true, secure: false, sameSite: 'lax' as const, path: '/', maxAge: 1000 }),
  generateDeviceId: (...args: unknown[]) => mockGenerateDeviceId(...args),
  recordLoginAndNotify: (...args: unknown[]) => mockRecordLoginAndNotify(...args),
}))

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
    mockGenerateDeviceId.mockReturnValue('new-device-id')
    mockRecordLoginAndNotify.mockResolvedValue({ notified: false })
  })

  it('未ログインは401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await POST(makeRequest())

    expect(response.status).toBe(401)
    expect(mockRecordLoginAndNotify).not.toHaveBeenCalled()
  })

  it('cookieが無ければ新規発行してSet-Cookieする。新規端末なら notified:true', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } } })
    mockRecordLoginAndNotify.mockResolvedValue({ notified: true })

    const response = await POST(makeRequest('Chrome/128 Macintosh'))
    const body = await response.json()

    expect(body).toEqual({ notified: true })
    expect(mockRecordLoginAndNotify).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@example.com',
      deviceId: 'new-device-id',
      userAgent: 'Chrome/128 Macintosh',
    })
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('agentpm_device=new-device-id')
  })

  it('既存cookieがあればそれを使い、Set-Cookieしない。既知端末なら notified:false', async () => {
    cookieJar['agentpm_device'] = 'existing-device-id'
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } } })
    mockRecordLoginAndNotify.mockResolvedValue({ notified: false })

    const response = await POST(makeRequest())
    const body = await response.json()

    expect(body).toEqual({ notified: false })
    expect(mockRecordLoginAndNotify).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'existing-device-id' })
    )
    expect(mockGenerateDeviceId).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
