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

import { sendInviteEmail } from '@/lib/email'

describe('Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ data: { id: 'test-message-id' }, error: null })
  })

  describe('sendInviteEmail', () => {
    const baseParams = {
      to: 'recipient@example.com',
      inviterName: 'John Doe',
      orgName: 'Test Org',
      spaceName: 'Test Project',
      token: 'abc123token',
      expiresAt: '2025-03-01T00:00:00Z',
    }

    it('should send client invite email with correct URL', async () => {
      const result = await sendInviteEmail({
        ...baseParams,
        role: 'client',
      })

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('test-message-id')
      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    it('should send member invite email with correct URL', async () => {
      const result = await sendInviteEmail({
        ...baseParams,
        role: 'member',
      })

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('test-message-id')
    })

    it('should use correct portal URL for client invites', async () => {
      await sendInviteEmail({
        ...baseParams,
        role: 'client',
      })

      const callArgs = mockSend.mock.calls[0][0]
      expect(callArgs.html).toContain('/portal/abc123token')
    })

    it('should use correct invite URL for member invites', async () => {
      await sendInviteEmail({
        ...baseParams,
        role: 'member',
      })

      const callArgs = mockSend.mock.calls[0][0]
      expect(callArgs.html).toContain('/invite/abc123token')
    })

    it('should escape HTML in user-provided content', async () => {
      await sendInviteEmail({
        ...baseParams,
        inviterName: '<script>alert("xss")</script>',
        orgName: 'Org<img src=x onerror=alert(1)>',
        spaceName: 'Project"onclick="evil()',
        role: 'client',
      })

      const callArgs = mockSend.mock.calls[0][0]
      // Check that dangerous characters are escaped
      expect(callArgs.html).not.toContain('<script>')
      expect(callArgs.html).toContain('&lt;script&gt;')
    })

    it('should handle email send error', async () => {
      mockSend.mockResolvedValueOnce({ data: null, error: { message: 'Rate limit exceeded' } })

      await expect(sendInviteEmail({
        ...baseParams,
        role: 'client',
      })).rejects.toThrow('Email send failed: Rate limit exceeded')
    })

    it('should include correct subject for client invite', async () => {
      await sendInviteEmail({
        ...baseParams,
        role: 'client',
      })

      const callArgs = mockSend.mock.calls[0][0]
      expect(callArgs.subject).toContain('プロジェクトへの招待')
    })

    it('should include correct subject for member invite', async () => {
      await sendInviteEmail({
        ...baseParams,
        role: 'member',
      })

      const callArgs = mockSend.mock.calls[0][0]
      expect(callArgs.subject).toContain('チームに招待されました')
    })
  })
})

describe('escapeHtml utility', () => {
  it('should handle special characters in org names', async () => {
    await sendInviteEmail({
      to: 'test@example.com',
      inviterName: 'Test & User',
      orgName: "O'Reilly <Media>",
      spaceName: 'Project "Alpha"',
      role: 'member',
      token: 'token123',
      expiresAt: '2025-03-01T00:00:00Z',
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('Test &amp; User')
    expect(callArgs.html).toContain('O&#039;Reilly &lt;Media&gt;')
    expect(callArgs.html).toContain('Project &quot;Alpha&quot;')
  })
})

describe('sendInviteEmail with optional message', () => {
  const baseParams = {
    to: 'recipient@example.com',
    inviterName: 'John Doe',
    orgName: 'Test Org',
    spaceName: 'Test Project',
    token: 'abc123token',
    expiresAt: '2025-03-01T00:00:00Z',
    role: 'client' as const,
  }

  it('does not render a quote block when no message is given', async () => {
    await sendInviteEmail({ ...baseParams })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).not.toContain('border-left')
  })

  it('renders the message in both html and text bodies', async () => {
    await sendInviteEmail({ ...baseParams, message: 'よろしくお願いします' })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('よろしくお願いします')
    expect(callArgs.html).toContain('border-left')
    expect(callArgs.text).toContain('よろしくお願いします')
  })

  it('escapes HTML in the message', async () => {
    await sendInviteEmail({
      ...baseParams,
      message: '<script>alert(1)</script>',
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).not.toContain('<script>')
    expect(callArgs.html).toContain('&lt;script&gt;')
  })
})

describe('FROM_EMAIL warning', () => {
  const baseParams = {
    to: 'recipient@example.com',
    inviterName: 'John Doe',
    orgName: 'Test Org',
    spaceName: 'Test Project',
    token: 'abc123token',
    expiresAt: '2025-03-01T00:00:00Z',
    role: 'client' as const,
  }

  it('warns once when FROM_EMAIL is not configured', async () => {
    const original = process.env.FROM_EMAIL
    delete process.env.FROM_EMAIL
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendInviteEmail({ ...baseParams })
    await sendInviteEmail({ ...baseParams })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('FROM_EMAIL が未設定です')
    )

    warnSpy.mockRestore()
    process.env.FROM_EMAIL = original
  })
})
