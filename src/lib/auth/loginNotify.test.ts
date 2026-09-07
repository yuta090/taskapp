import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockUpsert = vi.fn()
const mockSendLoginNewDeviceEmail = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
      upsert: mockUpsert,
    }),
  }),
}))

vi.mock('@/lib/email/loginNewDevice', () => ({
  sendLoginNewDeviceEmail: (...args: unknown[]) => mockSendLoginNewDeviceEmail(...args),
}))

const {
  DEVICE_COOKIE_NAME,
  deviceCookieOptions,
  generateDeviceId,
  recordLoginAndNotify,
} = await import('./loginNotify')

const baseInput = { userId: 'user-1', email: 'user@example.com', deviceId: 'device-abc', userAgent: 'Chrome/128 Macintosh' }

beforeEach(() => {
  vi.clearAllMocks()
  mockMaybeSingle.mockResolvedValue({ data: null, error: null })
  mockUpsert.mockResolvedValue({ error: null })
  mockSendLoginNewDeviceEmail.mockResolvedValue({ success: true })
})

describe('DEVICE_COOKIE_NAME / generateDeviceId / deviceCookieOptions', () => {
  it('cookie名は agentpm_device', () => {
    expect(DEVICE_COOKIE_NAME).toBe('agentpm_device')
  })

  it('generateDeviceId は32byte(64文字hex)で毎回ちがう値を返す', () => {
    const a = generateDeviceId()
    const b = generateDeviceId()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('deviceCookieOptions: httpOnly・lax・全パス・400日、本番のみsecure', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(deviceCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 400 * 24 * 60 * 60 })
    vi.stubEnv('NODE_ENV', 'production')
    expect(deviceCookieOptions().secure).toBe(true)
    vi.unstubAllEnvs()
  })
})

describe('recordLoginAndNotify', () => {
  it('新規端末: 記録して通知する', async () => {
    const result = await recordLoginAndNotify(baseInput)

    expect(result.notified).toBe(true)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', device_id: 'device-abc', user_agent: 'Chrome/128 Macintosh' }),
      { onConflict: 'user_id,device_id' },
    )
    expect(mockSendLoginNewDeviceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com', browserLabel: 'Chrome (Mac)' }),
    )
  })

  it('既知端末: 記録は更新するが通知はしない', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })

    const result = await recordLoginAndNotify(baseInput)

    expect(result.notified).toBe(false)
    expect(mockUpsert).toHaveBeenCalled()
    expect(mockSendLoginNewDeviceEmail).not.toHaveBeenCalled()
  })

  it('メール送信が失敗しても例外を投げない（notified: true のまま）', async () => {
    mockSendLoginNewDeviceEmail.mockRejectedValue(new Error('resend down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await recordLoginAndNotify(baseInput)

    expect(result.notified).toBe(true)
    expect(spy).toHaveBeenCalledWith('[login-notify] email send failed:', 'resend down')
  })

  it('既知判定のselectが失敗したら fail safe で通知しない・記録もしない', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await recordLoginAndNotify(baseInput)

    expect(result.notified).toBe(false)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith('[login-notify] select failed:', 'db down')
  })

  it('新規端末だがメールアドレスが無ければ記録だけして通知しない', async () => {
    const result = await recordLoginAndNotify({ ...baseInput, email: null })

    expect(result.notified).toBe(false)
    expect(mockUpsert).toHaveBeenCalled()
    expect(mockSendLoginNewDeviceEmail).not.toHaveBeenCalled()
  })
})
