import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Resend with proper class constructor
const mockSend = vi.fn().mockResolvedValue({ data: { id: 'test-message-id' }, error: null })

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = {
        send: mockSend,
      }
    },
  }
})

// Set environment variables before importing
process.env.RESEND_API_KEY = 'test-api-key'
process.env.FROM_EMAIL = 'test@example.com'
process.env.NEXT_PUBLIC_APP_NAME = 'TestApp'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

import { sendWelcomeEmail } from '@/lib/email/welcome'

describe('sendWelcomeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ data: { id: 'test-message-id' }, error: null })
  })

  const baseParams = {
    to: 'owner@example.com',
    orgName: 'テスト組織',
  }

  it('sends the welcome email with the correct subject', async () => {
    const result = await sendWelcomeEmail({ ...baseParams })

    expect(result.success).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.subject).toContain('ようこそ！最初の3ステップ')
    expect(callArgs.to).toBe('owner@example.com')
  })

  it('includes the 3-step guidance in both html and text bodies', async () => {
    await sendWelcomeEmail({ ...baseParams })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('最初のタスクを作成')
    expect(callArgs.html).toContain('メンバー・クライアントを招待')
    expect(callArgs.html).toContain('クライアントに公開')
    expect(callArgs.text).toContain('最初のタスクを作成')
    expect(callArgs.text).toContain('メンバー・クライアントを招待')
    expect(callArgs.text).toContain('クライアントに公開')
  })

  it('escapes HTML in the org name', async () => {
    await sendWelcomeEmail({ ...baseParams, orgName: '<script>alert(1)</script>' })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).not.toContain('<script>')
    expect(callArgs.html).toContain('&lt;script&gt;')
  })

  it('does not call Resend when dryRun is true', async () => {
    const result = await sendWelcomeEmail({ ...baseParams, dryRun: true })

    expect(mockSend).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.skipped).toBe(true)
  })

  it('handles email send error', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'Rate limit exceeded' } })

    await expect(sendWelcomeEmail({ ...baseParams })).rejects.toThrow('Email send failed: Rate limit exceeded')
  })
})

describe('sendWelcomeEmail without RESEND_API_KEY', () => {
  it('skips sending and returns success without throwing', async () => {
    const original = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendWelcomeEmail({ to: 'owner@example.com', orgName: 'テスト組織' })

    expect(result.success).toBe(true)
    expect(result.skipped).toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
    process.env.RESEND_API_KEY = original
  })
})

describe('sendWelcomeEmail FROM_EMAIL warning', () => {
  it('warns once when FROM_EMAIL is not configured', async () => {
    const original = process.env.FROM_EMAIL
    delete process.env.FROM_EMAIL
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendWelcomeEmail({ to: 'owner@example.com', orgName: 'テスト組織' })
    await sendWelcomeEmail({ to: 'owner@example.com', orgName: 'テスト組織' })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('FROM_EMAIL が未設定です')
    )

    warnSpy.mockRestore()
    process.env.FROM_EMAIL = original
  })
})
