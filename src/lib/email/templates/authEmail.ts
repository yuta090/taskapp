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

export const AUTH_TEMPLATE_KEYS = ['auth_signup', 'auth_recovery', 'auth_magiclink', 'auth_email_change', 'auth_invite'] as const
export type AuthTemplateKey = (typeof AUTH_TEMPLATE_KEYS)[number]

export interface AuthTemplateVars {
  email: string
  /** メール変更のときの変更先アドレス。それ以外は '' */
  newEmail: string
  /** 6桁などの確認コード（リンクが押せない人向け） */
  token: string
  appName: string
}

const P_EMAIL = { name: 'メールアドレス', varKey: 'email', description: '宛先のメールアドレス', sample: 'user@example.com' } as const
const P_NEW_EMAIL = { name: '新しいメールアドレス', varKey: 'newEmail', description: '変更先のメールアドレス', sample: 'new@example.com' } as const
const P_TOKEN = { name: '確認コード', varKey: 'token', description: 'ボタンが押せない人が画面に入力する確認コード', sample: '123456' } as const
const P_APP = { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' } as const

export const AUTH_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof AuthTemplateVars }> = [P_EMAIL, P_NEW_EMAIL, P_TOKEN, P_APP]

/** キーごとに使える差し込み語（「新しいメールアドレス」はメール変更のみ） */
export const AUTH_PLACEHOLDERS_BY_KEY: Record<AuthTemplateKey, ReadonlyArray<PlaceholderDef & { varKey: keyof AuthTemplateVars }>> = {
  auth_signup: [P_EMAIL, P_TOKEN, P_APP],
  auth_recovery: [P_EMAIL, P_TOKEN, P_APP],
  auth_magiclink: [P_EMAIL, P_TOKEN, P_APP],
  auth_email_change: [P_EMAIL, P_NEW_EMAIL, P_TOKEN, P_APP],
  auth_invite: [P_EMAIL, P_APP],
}

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
      'ログイン用のメールアドレスを {{新しいメールアドレス}} に変更するリクエストを受け付けました。',
      '下のボタンを押して変更を確定してください（新旧どちらのアドレスにも確認メールが届きます。両方の確認で変更が完了します）。',
      '',
      'このリクエストに心当たりがない場合は、このメールを無視してください。メールアドレスは変更されません。',
    ].join('\n'),
    cta_label: '変更を確定する',
    note: '',
  },
  auth_invite: {
    subject: '【{{サービス名}}】{{サービス名}} への招待',
    heading: '{{サービス名}} への招待',
    body: [
      '{{サービス名}} にあなたのアカウント（{{メールアドレス}}）が用意されました。',
      '下のボタンからアカウントの設定を完了してください。',
    ].join('\n'),
    cta_label: 'アカウントを設定する',
    note: '',
  },
}

export const AUTH_TEMPLATE_META: Record<AuthTemplateKey, { label: string; description: string; accent: string }> = {
  auth_signup: { label: '会員登録の確認', description: 'サインアップ直後に届く、メールアドレス確認のメール', accent: '#4f46e5' },
  auth_recovery: { label: 'パスワード再設定', description: '「パスワードを忘れた」から届く、再設定リンクのメール', accent: '#4f46e5' },
  auth_magiclink: { label: 'ログイン用リンク', description: 'パスワードなしでログインするためのリンクのメール', accent: '#4f46e5' },
  auth_email_change: { label: 'メールアドレス変更の確認', description: 'ログイン用メールアドレスを変えるときの確認メール（旧・新の両方のアドレスに同じ文面で届く）', accent: '#4f46e5' },
  auth_invite: { label: 'アカウント招待（運営発行）', description: '運営が Supabase から直接アカウントを招待したときのメール（通常の相手先・メンバー招待は「招待」カテゴリ）', accent: '#4f46e5' },
}

/**
 * Supabase の email_action_type → テンプレートのキー。
 * 対応が無いもの（reauthentication = 再認証コード等）は null（呼び出し側が確認コードだけの簡易文面で送る）。
 * 'email'（コードでのログイン）はログイン用リンクと同じ文面。'email_change' は旧・新の2通を呼び出し側が送る。
 */
export function authTemplateKeyFor(emailActionType: string): AuthTemplateKey | null {
  switch (emailActionType) {
    case 'signup':
      return 'auth_signup'
    case 'recovery':
      return 'auth_recovery'
    case 'magiclink':
    case 'email':
      return 'auth_magiclink'
    case 'email_change':
      return 'auth_email_change'
    case 'invite':
      return 'auth_invite'
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
