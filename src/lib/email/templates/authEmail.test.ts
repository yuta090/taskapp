import { describe, it, expect } from 'vitest'
import { AUTH_PLACEHOLDERS, AUTH_PLACEHOLDERS_BY_KEY, AUTH_TEMPLATE_DEFAULTS, AUTH_TEMPLATE_KEYS, authTemplateKeyFor, buildVerifyUrl, renderAuthEmail } from './authEmail'

const vars = { email: 'user@example.com', newEmail: 'new@example.com', token: '123456', appName: 'AgentPM' }

describe('auth email templates', () => {
  it('Supabase の種類 → キー（未対応は null）', () => {
    expect(authTemplateKeyFor('signup')).toBe('auth_signup')
    expect(authTemplateKeyFor('recovery')).toBe('auth_recovery')
    expect(authTemplateKeyFor('magiclink')).toBe('auth_magiclink')
    expect(authTemplateKeyFor('email')).toBe('auth_magiclink')
    expect(authTemplateKeyFor('email_change')).toBe('auth_email_change')
    expect(authTemplateKeyFor('invite')).toBe('auth_invite')
    expect(authTemplateKeyFor('reauthentication')).toBeNull()
    expect(authTemplateKeyFor('email_change_new')).toBeNull()
  })

  it('確認URLは Supabase の verify エンドポイント（redirect_to 付き・URLエンコード）', () => {
    const url = buildVerifyUrl({ supabaseUrl: 'https://abc.supabase.co', tokenHash: 'h4sh', type: 'recovery', redirectTo: 'https://agentpm.app/reset/confirm?x=1' })
    expect(url).toBe('https://abc.supabase.co/auth/v1/verify?token=h4sh&type=recovery&redirect_to=https%3A%2F%2Fagentpm.app%2Freset%2Fconfirm%3Fx%3D1')
    expect(buildVerifyUrl({ supabaseUrl: 'https://abc.supabase.co', tokenHash: 'h', type: 'signup', redirectTo: '' })).not.toContain('redirect_to')
  })

  it('既定文面: 全キーが差し込み済みで描け、確認URLがボタンになる', () => {
    for (const key of AUTH_TEMPLATE_KEYS) {
      const out = renderAuthEmail({ key, fields: AUTH_TEMPLATE_DEFAULTS[key], vars, actionUrl: 'https://abc.supabase.co/auth/v1/verify?token=h&type=x' })
      expect(out.html).not.toContain('{{')
      expect(out.text).not.toContain('{{')
      expect(out.html).toContain('href="https://abc.supabase.co/auth/v1/verify?token=h&amp;type=x"')
      expect(out.subject).toContain('【AgentPM】')
    }
    const signup = renderAuthEmail({ key: 'auth_signup', fields: AUTH_TEMPLATE_DEFAULTS.auth_signup, vars, actionUrl: 'https://x' })
    expect(signup.html).toContain('メールアドレス（user@example.com）の確認')
    expect(signup.html).toContain('確認コード 123456 を画面に入力')
    expect(signup.html).toContain('>メールアドレスを確認する</a>')
    const recovery = renderAuthEmail({ key: 'auth_recovery', fields: AUTH_TEMPLATE_DEFAULTS.auth_recovery, vars, actionUrl: 'https://x' })
    expect(recovery.text).toContain('心当たりがない場合は、このメールを無視してください。パスワードは変更されません。')
  })

  it('差し込み値（メールアドレス）はエスケープされる', () => {
    const out = renderAuthEmail({ key: 'auth_signup', fields: AUTH_TEMPLATE_DEFAULTS.auth_signup, vars: { ...vars, email: '<x@y>' }, actionUrl: 'https://x' })
    expect(out.html).toContain('&lt;x@y&gt;')
    expect(AUTH_PLACEHOLDERS.map((p) => p.name)).toEqual(['メールアドレス', '新しいメールアドレス', '確認コード', 'サービス名'])
  })

  it('「新しいメールアドレス」はメール変更だけで使える。メール変更の既定文面は変更先を載せる', () => {
    expect(AUTH_PLACEHOLDERS_BY_KEY.auth_email_change.map((p) => p.name)).toContain('新しいメールアドレス')
    expect(AUTH_PLACEHOLDERS_BY_KEY.auth_signup.map((p) => p.name)).not.toContain('新しいメールアドレス')
    const out = renderAuthEmail({ key: 'auth_email_change', fields: AUTH_TEMPLATE_DEFAULTS.auth_email_change, vars, actionUrl: 'https://x' })
    expect(out.html).toContain('new@example.com に変更するリクエスト')
  })
})
