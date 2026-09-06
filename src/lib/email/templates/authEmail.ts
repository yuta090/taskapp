/**
 * 会員登録・ログインまわりの認証メール（Supabase Auth の Send Email Hook 経由で当社が送る）。
 *
 * 従来は Supabase が自前のテンプレートで送っていたため管理画面から触れなかった。
 * Supabase の「Send Email Hook」を当社の POST /api/auth/send-email-hook に向けると、
 * サインアップ確認・パスワード再設定・ログイン用リンク・メール変更確認の4通を
 * ここの文面（運営が管理画面で編集可）＋当社の差出人で送れる。
 * リンク先（確認URL）はコード固定で、文面からは変えられない。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { renderSimpleEmail, type PlaceholderDef, type RenderedEmail, type TemplateFields, type TemplateVars } from './core'

export const AUTH_TEMPLATE_KEYS = ['auth_signup', 'auth_recovery', 'auth_magiclink', 'auth_email_change'] as const
export type AuthTemplateKey = (typeof AUTH_TEMPLATE_KEYS)[number]

export interface AuthTemplateVars {
  email: string
  /** 6桁などの確認コード（リンクが押せない人向け） */
  token: string
  appName: string
}

export const AUTH_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof AuthTemplateVars }> = [
  { name: 'メールアドレス', varKey: 'email', description: '宛先のメールアドレス', sample: 'user@example.com' },
  { name: '確認コード', varKey: 'token', description: 'ボタンが押せない人が画面に入力する確認コード', sample: '123456' },
  { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' },
]

export function authVarsByName(vars: AuthTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of AUTH_PLACEHOLDERS) out[p.name] = vars[p.varKey]
  return out
}

const CODE_NOTE = 'ボタンが押せない場合は、確認コード {{確認コード}} を画面に入力してください。'

export const AUTH_TEMPLATE_DEFAULTS: Record<AuthTemplateKey, TemplateFields> = {
  auth_signup: {
    subject: '【{{サービス名}}】メールアドレスの確認',
    heading: 'メールアドレスの確認',
    body: [
      '{{サービス名}} にご登録いただきありがとうございます。',
      '下のボタンを押して、メールアドレス（{{メールアドレス}}）の確認を完了してください。',
    ].join('\n'),
    cta_label: 'メールアドレスを確認する',
    note: CODE_NOTE,
  },
  auth_recovery: {
    subject: '【{{サービス名}}】パスワード再設定のご案内',
    heading: 'パスワードの再設定',
    body: [
      'パスワード再設定のリクエストを受け付けました。',
      '下のボタンから新しいパスワードを設定してください。',
      '',
      'このリクエストに心当たりがない場合は、このメールを無視してください。パスワードは変更されません。',
    ].join('\n'),
    cta_label: 'パスワードを再設定する',
    note: '',
  },
  auth_magiclink: {
    subject: '【{{サービス名}}】ログイン用リンク',
    heading: 'ログイン用リンク',
    body: '下のボタンを押すと {{サービス名}} にログインできます。',
    cta_label: 'ログインする',
    note: CODE_NOTE,
  },
  auth_email_change: {
    subject: '【{{サービス名}}】メールアドレス変更の確認',
    heading: 'メールアドレス変更の確認',
    body: [
      'メールアドレスを {{メールアドレス}} に変更するリクエストを受け付けました。',
      '下のボタンを押して変更を確定してください。',
    ].join('\n'),
    cta_label: '変更を確定する',
    note: '',
  },
}

export const AUTH_TEMPLATE_META: Record<AuthTemplateKey, { label: string; description: string; accent: string }> = {
  auth_signup: { label: '会員登録の確認', description: 'サインアップ直後に届く、メールアドレス確認のメール', accent: '#4f46e5' },
  auth_recovery: { label: 'パスワード再設定', description: '「パスワードを忘れた」から届く、再設定リンクのメール', accent: '#4f46e5' },
  auth_magiclink: { label: 'ログイン用リンク', description: 'パスワードなしでログインするためのリンクのメール', accent: '#4f46e5' },
  auth_email_change: { label: 'メールアドレス変更の確認', description: 'ログイン用メールアドレスを変えるときの確認メール', accent: '#4f46e5' },
}

/**
 * Supabase の email_action_type → テンプレートのキー。対応が無いもの（再認証コード等）は null（呼び出し側が簡易文面で送る）。
 * email_change_new は「新しいアドレス宛」の変更確認で、同じ文面を使う。
 */
export function authTemplateKeyFor(emailActionType: string): AuthTemplateKey | null {
  switch (emailActionType) {
    case 'signup':
      return 'auth_signup'
    case 'recovery':
      return 'auth_recovery'
    case 'magiclink':
      return 'auth_magiclink'
    case 'email_change':
    case 'email_change_new':
      return 'auth_email_change'
    default:
      return null
  }
}

/** Supabase の確認URL（クリックで検証→redirect_to へ戻る）。従来の {{ .ConfirmationURL }} と同じ形 */
export function buildVerifyUrl(input: { supabaseUrl: string; tokenHash: string; type: string; redirectTo: string }): string {
  const u = new URL('/auth/v1/verify', input.supabaseUrl)
  u.searchParams.set('token', input.tokenHash)
  u.searchParams.set('type', input.type)
  if (input.redirectTo) u.searchParams.set('redirect_to', input.redirectTo)
  return u.toString()
}

export function renderAuthEmail(input: { key: AuthTemplateKey; fields: TemplateFields; vars: AuthTemplateVars; actionUrl: string }): RenderedEmail {
  return renderSimpleEmail({
    appName: input.vars.appName,
    accent: AUTH_TEMPLATE_META[input.key].accent,
    fields: input.fields,
    vars: authVarsByName(input.vars),
    ctaUrl: input.actionUrl,
  })
}
