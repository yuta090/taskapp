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

import { sendApprovalEmail } from '@/lib/email/approval'

describe('sendApprovalEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ data: { id: 'test-message-id' }, error: null })
  })

  const baseParams = {
    to: 'client@example.com',
    token: 'abc123token',
    taskTitle: 'フロントエンド実装',
    spaceName: 'ECサイトリニューアル',
    orgName: 'クラフトテック',
    actionType: 'approve' as const,
    estimatedCost: null,
  }

  it('does not show a due date when none is given', async () => {
    await sendApprovalEmail({ ...baseParams })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).not.toContain('期限')
  })

  it('shows the due date formatted as YYYY/M/D when given', async () => {
    await sendApprovalEmail({ ...baseParams, dueDate: '2026-07-10' })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('期限')
    expect(callArgs.html).toContain('2026/7/10')
  })

  it('does not show a description excerpt when none is given', async () => {
    await sendApprovalEmail({ ...baseParams })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).not.toContain('descriptionExcerpt')
  })

  it('shows the description excerpt when given', async () => {
    await sendApprovalEmail({
      ...baseParams,
      descriptionExcerpt: 'ログイン画面のレイアウトをFigma通りに実装する',
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('ログイン画面のレイアウトをFigma通りに実装する')
  })

  it('escapes HTML in the description excerpt', async () => {
    await sendApprovalEmail({
      ...baseParams,
      descriptionExcerpt: '<script>alert(1)</script>',
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).not.toContain('<script>')
    expect(callArgs.html).toContain('&lt;script&gt;')
  })
})

describe('sendApprovalEmail FROM_EMAIL warning', () => {
  const baseParams = {
    to: 'client@example.com',
    token: 'abc123token',
    taskTitle: 'フロントエンド実装',
    spaceName: 'ECサイトリニューアル',
    orgName: 'クラフトテック',
    actionType: 'approve' as const,
    estimatedCost: null,
  }

  it('warns once when FROM_EMAIL is not configured', async () => {
    const original = process.env.FROM_EMAIL
    delete process.env.FROM_EMAIL
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendApprovalEmail({ ...baseParams })
    await sendApprovalEmail({ ...baseParams })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('FROM_EMAIL が未設定です')
    )

    warnSpy.mockRestore()
    process.env.FROM_EMAIL = original
  })
})
