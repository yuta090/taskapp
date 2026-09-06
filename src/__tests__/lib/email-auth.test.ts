import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 認証メール送信: 種類ごとの文面・確認URL・未対応種類の簡易文面 */
const mockSend = vi.fn().mockResolvedValue({ data: { id: 'msg' }, error: null })
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend } } }))

let templateRows: Array<Record<string, unknown>> = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: () => Promise.resolve({ data: templateRows, error: null }) }) }) }),
}))

process.env.RESEND_API_KEY = 'test'
process.env.FROM_EMAIL = 'noreply@example.com'
process.env.NEXT_PUBLIC_APP_NAME = 'AgentPM'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'

const { sendAuthEmail } = await import('@/lib/email/sendAuthEmail')
const { resetEmailTemplateCache } = await import('@/lib/email/templates/loadEmailTemplate')

const base = {
  user: { id: 'u1', email: 'user@example.com' },
  email_data: { token: '123456', token_hash: 'h4sh', redirect_to: 'https://agentpm.app/reset/confirm', email_action_type: 'recovery' },
}

beforeEach(() => {
  vi.clearAllMocks()
  templateRows = []
  resetEmailTemplateCache()
})

describe('sendAuthEmail', () => {
  it('パスワード再設定: 既定文面＋Supabase の確認URL（redirect_to 付き）', async () => {
    const r = await sendAuthEmail(base)
    expect(r.templateKey).toBe('auth_recovery')
    const a = mockSend.mock.calls[0][0]
    expect(a.to).toBe('user@example.com')
    expect(a.subject).toBe('【AgentPM】パスワード再設定のご案内')
    expect(a.html).toContain('href="https://abc.supabase.co/auth/v1/verify?token=h4sh&amp;type=recovery&amp;redirect_to=https%3A%2F%2Fagentpm.app%2Freset%2Fconfirm"')
    expect(a.text).toContain('https://abc.supabase.co/auth/v1/verify?token=h4sh&type=recovery&redirect_to=https%3A%2F%2Fagentpm.app%2Freset%2Fconfirm')
  })

  it('会員登録の確認: 確認コードが補足に入る。保存文面があればそれで送る', async () => {
    await sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'signup' } })
    expect(mockSend.mock.calls[0][0].html).toContain('確認コード 123456')
    templateRows = [{ key: 'auth_signup', subject: '独自 {{メールアドレス}}', heading: 'H', body: 'B', cta_label: 'C', note: '' }]
    await sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'signup' } })
    expect(mockSend.mock.calls[1][0].subject).toBe('独自 user@example.com')
  })

  it('メール変更は旧アドレス(token_hash)と新アドレス(token_hash_new)の2通に分けて送る', async () => {
    const r = await sendAuthEmail({
      user: { id: 'u1', email: 'old@example.com', new_email: 'new@example.com' },
      email_data: { ...base.email_data, email_action_type: 'email_change', token_hash: 'oldhash', token: '111111', token_hash_new: 'newhash', token_new: '222222' },
    })
    expect(r.sent).toBe(2)
    expect(mockSend).toHaveBeenCalledTimes(2)
    const [a, b] = mockSend.mock.calls.map((c) => c[0])
    expect(a.to).toBe('old@example.com')
    expect(a.html).toContain('token=oldhash&amp;type=email_change')
    expect(b.to).toBe('new@example.com')
    expect(b.html).toContain('token=newhash&amp;type=email_change')
    expect(b.html).toContain('new@example.com に変更するリクエスト')
    expect(a.subject).toContain('メールアドレス変更の確認')
  })

  it('メール変更で new_email が無ければ旧アドレスの1通だけ。token_hash も無ければ例外', async () => {
    const r = await sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'email_change' } })
    expect(r.sent).toBe(1)
    await expect(sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'email_change', token_hash: '' } })).rejects.toThrow('email_change')
  })

  it('コードでのログイン(email)はログイン用リンクの文面で type=magiclink、招待(invite)は招待文面', async () => {
    await sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'email' } })
    expect(mockSend.mock.calls[0][0].html).toContain('type=magiclink')
    await sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'invite' } })
    expect(mockSend.mock.calls[1][0].subject).toContain('への招待')
    expect(mockSend.mock.calls[1][0].html).toContain('type=invite')
  })

  it('未対応の種類（再認証）は確認コードだけの簡易文面で送り、警告ログを出す。コードも無ければ例外', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'reauthentication' } })
    expect(r.templateKey).toBeNull()
    const a = mockSend.mock.calls[0][0]
    expect(a.subject).toBe('【AgentPM】確認コード')
    expect(a.text).toContain('123456')
    expect(a.html).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unhandled email_action_type'), 'reauthentication')
    await expect(sendAuthEmail({ ...base, email_data: { ...base.email_data, email_action_type: 'reauthentication', token: '' } })).rejects.toThrow('no token')
  })

  it('宛先が無ければ例外・Resend エラーは例外', async () => {
    await expect(sendAuthEmail({ ...base, user: { email: '' } })).rejects.toThrow('recipient')
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } })
    await expect(sendAuthEmail(base)).rejects.toThrow('Email send failed: rate limited')
  })
})
