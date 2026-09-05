import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordAuthFailure } from '@/lib/auth/authEventLog'

const mockInsert = vi.fn()
const mockFrom = vi.fn(() => ({ insert: mockInsert }))
const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:4000/auth/callback?code=abc', { headers })
}

describe('recordAuthFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('auth_event_logs に段階・理由・IP・UA を1行入れる', async () => {
    await recordAuthFailure({
      stage: 'provider_callback',
      provider: 'google',
      errorCode: 'unexpected_failure',
      errorDescription: 'Unable to exchange external code',
      request: makeRequest({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8', 'user-agent': 'UA/1.0' }),
      metadata: { error: 'server_error' },
    })

    expect(mockFrom).toHaveBeenCalledWith('auth_event_logs')
    expect(mockInsert).toHaveBeenCalledWith({
      stage: 'provider_callback',
      provider: 'google',
      error_code: 'unexpected_failure',
      error_description: 'Unable to exchange external code',
      user_id: null,
      email: null,
      ip: '1.2.3.4',
      user_agent: 'UA/1.0',
      metadata: { error: 'server_error' },
    })
  })

  it('長すぎる説明・UAは切り詰める（DBとログを汚さない）', async () => {
    await recordAuthFailure({
      stage: 'code_exchange',
      errorDescription: 'x'.repeat(2000),
      request: makeRequest({ 'user-agent': 'u'.repeat(1000) }),
    })

    const row = mockInsert.mock.calls[0][0]
    expect(row.error_description).toHaveLength(1000)
    expect(row.user_agent).toHaveLength(256)
    expect(row.provider).toBe('google')
  })

  it('DB書き込みに失敗しても例外を投げない（ログイン動線を止めない）', async () => {
    mockInsert.mockRejectedValue(new Error('db down'))

    await expect(recordAuthFailure({ stage: 'missing_code' })).resolves.toBeUndefined()
  })

  it('insert がエラーを返しても例外を投げない', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(recordAuthFailure({ stage: 'missing_code' })).resolves.toBeUndefined()
  })

  it('service role 未設定（admin client 生成失敗）でも例外を投げない', async () => {
    mockCreateAdminClient.mockImplementationOnce(() => {
      throw new Error('Missing Supabase configuration for admin client')
    })

    await expect(recordAuthFailure({ stage: 'landing', userId: 'u1' })).resolves.toBeUndefined()
  })
})
