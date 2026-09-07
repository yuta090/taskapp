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
  generateDeviceId,
  isNotifiableEmail,
  recordDeviceLogin,
  notifyNewDevice,
} = await import('./loginNotify')

const baseRecordInput = { userId: 'user-1', deviceId: 'device-abc', userAgent: 'Chrome/128 Macintosh' }

beforeEach(() => {
  vi.clearAllMocks()
  mockMaybeSingle.mockResolvedValue({ data: null, error: null })
  mockUpsert.mockResolvedValue({ error: null })
  mockSendLoginNewDeviceEmail.mockResolvedValue({ success: true })
})

describe('DEVICE_COOKIE_NAME / generateDeviceId', () => {
  it('cookie名は agentpm_device（deviceCookie.tsと同じ値をre-exportしている）', () => {
    expect(DEVICE_COOKIE_NAME).toBe('agentpm_device')
  })

  it('generateDeviceId は32byte(64文字hex)で毎回ちがう値を返す', () => {
    const a = generateDeviceId()
    const b = generateDeviceId()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})

describe('isNotifiableEmail', () => {
  it('通常のメールアドレスは通知対象', () => {
    expect(isNotifiableEmail('user@example.co.jp')).toBe(true)
    expect(isNotifiableEmail('taro.yamada@agentpm.app')).toBe(true)
  })

  it('デモ・予約アドレスは通知対象外（example.com / .invalid / .test / client.com）', () => {
    expect(isNotifiableEmail('demo@example.com')).toBe(false)
    expect(isNotifiableEmail('user@foo.invalid')).toBe(false)
    expect(isNotifiableEmail('user@foo.test')).toBe(false)
    expect(isNotifiableEmail('client1@client.com')).toBe(false)
  })

  it('大文字小文字を区別しない', () => {
    expect(isNotifiableEmail('DEMO@EXAMPLE.COM')).toBe(false)
  })
})

describe('recordDeviceLogin', () => {
  it('新規端末: isNew=true で記録する（メール送信はしない）', async () => {
    const result = await recordDeviceLogin(baseRecordInput)

    expect(result.isNew).toBe(true)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', device_id: 'device-abc', user_agent: 'Chrome/128 Macintosh' }),
      { onConflict: 'user_id,device_id' },
    )
    expect(mockSendLoginNewDeviceEmail).not.toHaveBeenCalled()
  })

  it('既知端末: isNew=false だが last_seen_at 更新のため記録は更新する', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })

    const result = await recordDeviceLogin(baseRecordInput)

    expect(result.isNew).toBe(false)
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('User-Agent は256文字で切って保存する（authEventLogsと同じ長さ）', async () => {
    const longUa = 'A'.repeat(300)
    await recordDeviceLogin({ ...baseRecordInput, userAgent: longUa })

    const savedUa = mockUpsert.mock.calls[0][0].user_agent as string
    expect(savedUa.length).toBe(256)
    expect(savedUa).toBe('A'.repeat(256))
  })

  it('既知判定のselectが失敗したら取りこぼしを選び、記録もしない', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await recordDeviceLogin(baseRecordInput)

    expect(result.isNew).toBe(false)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('select failed'), 'db down')
  })
})

describe('notifyNewDevice', () => {
  it('通知対象のメールなら送る', async () => {
    await notifyNewDevice({ email: 'user@example.co.jp', userAgent: 'Chrome/128 Macintosh' })

    expect(mockSendLoginNewDeviceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.co.jp', browserLabel: 'Chrome (Mac)' }),
    )
  })

  it('デモ・予約アドレスには送らない', async () => {
    await notifyNewDevice({ email: 'demo@example.com', userAgent: null })

    expect(mockSendLoginNewDeviceEmail).not.toHaveBeenCalled()
  })

  it('メールアドレスが無ければ送らない', async () => {
    await notifyNewDevice({ email: null, userAgent: null })

    expect(mockSendLoginNewDeviceEmail).not.toHaveBeenCalled()
  })

  it('メール送信が失敗しても例外を投げない', async () => {
    mockSendLoginNewDeviceEmail.mockRejectedValue(new Error('resend down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(notifyNewDevice({ email: 'user@example.co.jp', userAgent: null })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('[login-notify] email send failed:', 'resend down')
  })
})
