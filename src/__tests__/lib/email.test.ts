import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetFromEmailWarning } from '@/lib/email/from'
import { resetEmailTemplateCache } from '@/lib/email/templates/loadEmailTemplate'

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

// 文面の読み込み(email_templates)は DB を見に行かない: 行なし = コード既定の文面で送る
let templateRows: Array<Record<string, unknown>> = []
// 事務所(org)が保存した文面。null = 保存なし
let orgTemplateRow: Record<string, unknown> | null = null
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'org_email_templates') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: orgTemplateRow, error: null }) }) }),
          }),
        }
      }
      return { select: () => ({ in: () => Promise.resolve({ data: templateRows, error: null }) }) }
    },
  }),
}))

// Set environment variables before importing
process.env.RESEND_API_KEY = 'test-api-key'
process.env.FROM_EMAIL = 'test@example.com'
process.env.NEXT_PUBLIC_APP_NAME = 'TestApp'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

import { sendInviteEmail } from '@/lib/email'

describe('Email Service', () => {
  beforeEach(() => {
  resetFromEmailWarning()
  resetEmailTemplateCache()
    vi.clearAllMocks()
    templateRows = []
    orgTemplateRow = null
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

describe('sendInviteEmail — アカウント要否の明記 (初回UX改善)', () => {
  const baseParams = {
    to: 'recipient@example.com',
    inviterName: 'John Doe',
    orgName: 'Test Org',
    spaceName: 'Test Project',
    token: 'abc123token',
    expiresAt: '2025-03-01T00:00:00Z',
  }

  it('クライアント向けはアカウント登録が不要である旨をHTML/textの両方に含める', async () => {
    await sendInviteEmail({ ...baseParams, role: 'client' })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('アカウント登録は不要です')
    expect(callArgs.text).toContain('アカウント登録は不要です')
  })

  it('内部メンバー向けは無料のアカウント作成を案内する旨をHTML/textの両方に含める', async () => {
    await sendInviteEmail({ ...baseParams, role: 'member' })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('無料のアカウント作成')
    expect(callArgs.text).toContain('無料のアカウント作成')
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

describe('sendInviteEmail — 管理画面で保存した文面が実際に使われる', () => {
  const baseParams = {
    to: 'recipient@example.com',
    inviterName: 'John Doe',
    orgName: 'Test Org',
    spaceName: 'Test Project',
    token: 'abc123token',
    expiresAt: '2025-03-01T00:00:00Z',
  }

  beforeEach(() => {
  resetFromEmailWarning()
  resetEmailTemplateCache()
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ data: { id: 'test-message-id' }, error: null })
    templateRows = [
      {
        key: 'invite_client',
        subject: '独自件名 {{組織名}}',
        heading: '独自見出し',
        body: '{{招待者名}} さんからの独自本文',
        cta_label: '独自ボタン',
        note: '',
        updated_at: '2026-09-07T00:00:00Z',
      },
    ]
  })

  it('client 向けは保存した文面（invite_client）で送る', async () => {
    await sendInviteEmail({ ...baseParams, role: 'client' })
    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.subject).toBe('独自件名 Test Org')
    expect(callArgs.html).toContain('独自見出し')
    expect(callArgs.html).toContain('John Doe さんからの独自本文')
    expect(callArgs.html).toContain('>独自ボタン<')
    expect(callArgs.text).toContain('独自ボタン:\nhttp://localhost:3000/portal/abc123token')
    expect(callArgs.html).not.toContain('アカウント登録は不要です')
  })

  it('member 向けは invite_member が未保存なので既定文面のまま（取り違えない）', async () => {
    await sendInviteEmail({ ...baseParams, role: 'member' })
    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.subject).toContain('チームに招待されました')
    expect(callArgs.subject).not.toContain('独自件名')
    expect(callArgs.html).toContain('無料のアカウント作成')
  })
})

describe('sendInviteEmail — 差出人と返信先', () => {
  const baseParams = {
    to: 'recipient@example.com',
    inviterName: 'John Doe',
    orgName: 'Test Org',
    spaceName: 'Test Project',
    token: 'abc123token',
    expiresAt: '2025-03-01T00:00:00Z',
  }

  it('From は「事務所名 (サービス名)」（有料プランで senderOrgName が渡ったとき）、返信先は招待した人', async () => {
    await sendInviteEmail({ ...baseParams, role: 'client', replyTo: 'inviter@example.com', senderOrgName: 'Test Org' })
    const a = mockSend.mock.calls[0][0]
    expect(a.from).toBe('"Test Org (TestApp)" <test@example.com>')
    expect(a.replyTo).toBe('inviter@example.com')
  })

  it('返信先が不正（改行入り）なら付けない。senderOrgName が無ければ（無料プラン）表示名はサービス名のみ', async () => {
    await sendInviteEmail({ ...baseParams, role: 'member', replyTo: 'x\r\nBcc: y@z' })
    expect(mockSend.mock.calls[0][0].replyTo).toBeUndefined()
    expect(mockSend.mock.calls[0][0].from).toBe('"TestApp" <test@example.com>')
  })
})

describe('sendInviteEmail — 事務所の文面とその場の差し替え', () => {
  const ORG_ID = '11111111-1111-4111-8111-111111111111'
  const baseParams = {
    to: 'recipient@example.com',
    inviterName: 'John Doe',
    orgName: 'Test Org',
    spaceName: 'Test Project',
    role: 'member' as const,
    token: 'abc123token',
    expiresAt: '2026-03-01T00:00:00Z',
  }

  beforeEach(() => {
    resetEmailTemplateCache()
    vi.clearAllMocks()
    templateRows = []
    orgTemplateRow = null
    mockSend.mockResolvedValue({ data: { id: 'test-message-id' }, error: null })
  })

  it('事務所が保存した文面があれば、それで送る', async () => {
    orgTemplateRow = {
      subject: '事務所の件名',
      heading: '事務所の見出し',
      body: '事務所の本文',
      cta_label: '参加する',
      note: '',
    }
    await sendInviteEmail({ ...baseParams, orgId: ORG_ID })
    const sent = mockSend.mock.calls[0][0]
    expect(sent.subject).toBe('事務所の件名')
    expect(sent.html).toContain('事務所の本文')
  })

  it('事務所の保存より、その場で差し替えた文面が優先される（保存はしない）', async () => {
    orgTemplateRow = {
      subject: '事務所の件名',
      heading: '事務所の見出し',
      body: '事務所の本文',
      cta_label: '参加する',
      note: '',
    }
    await sendInviteEmail({
      ...baseParams,
      orgId: ORG_ID,
      fields: { subject: '今回だけの件名', heading: '見出し', body: '今回だけの本文', cta_label: '参加する', note: '' },
    })
    const sent = mockSend.mock.calls[0][0]
    expect(sent.subject).toBe('今回だけの件名')
    expect(sent.html).toContain('今回だけの本文')
    expect(sent.html).not.toContain('事務所の本文')
  })

  it('事務所が分からないときは、これまでどおり運営/既定の文面で送る', async () => {
    orgTemplateRow = { subject: '事務所の件名', heading: 'H', body: 'B', cta_label: 'C', note: '' }
    await sendInviteEmail(baseParams)
    const sent = mockSend.mock.calls[0][0]
    expect(sent.subject).not.toBe('事務所の件名')
  })
})
