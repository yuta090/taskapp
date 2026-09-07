/**
 * 新しい端末からの初回ログイン通知（なりすましログイン対策）。
 *
 * 端末の識別（cookie）・既知判定（DB）・送信要否の判断は src/lib/auth/loginNotify.ts が担う。
 * ここは「本人向け・純粋な文面」だけを持つ（管理画面で編集可能。カテゴリは既存の
 * 'account'＝会員登録・ログインに載せる）。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { renderSimpleEmail, type PlaceholderDef, type RenderedEmail, type TemplateFields, type TemplateVars } from './core'

export const LOGIN_NEW_DEVICE_TEMPLATE_KEY = 'login_new_device' as const

export interface LoginNewDeviceTemplateVars {
  /** JST の日時ラベル（例: 2026年9月7日 10:05） */
  dateTimeLabel: string
  /** ブラウザ・OS の簡易ラベル（例: Chrome (Mac)） */
  browserLabel: string
  email: string
  appName: string
}

const P_DATETIME: PlaceholderDef & { varKey: keyof LoginNewDeviceTemplateVars } = {
  name: '日時',
  varKey: 'dateTimeLabel',
  description: 'ログインした日時（日本時間）',
  sample: '2026年9月7日 10:05',
}
const P_BROWSER: PlaceholderDef & { varKey: keyof LoginNewDeviceTemplateVars } = {
  name: 'ブラウザ',
  varKey: 'browserLabel',
  description: 'ログインに使われたブラウザ・端末の種類（簡易判定）',
  sample: 'Chrome (Mac)',
}
const P_EMAIL: PlaceholderDef & { varKey: keyof LoginNewDeviceTemplateVars } = {
  name: 'メールアドレス',
  varKey: 'email',
  description: 'ログインしたアカウントのメールアドレス',
  sample: 'user@example.com',
}
const P_APP: PlaceholderDef & { varKey: keyof LoginNewDeviceTemplateVars } = {
  name: 'サービス名',
  varKey: 'appName',
  description: 'このサービスの名前',
  sample: 'AgentPM',
}

export const LOGIN_NEW_DEVICE_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof LoginNewDeviceTemplateVars }> = [
  P_DATETIME,
  P_BROWSER,
  P_EMAIL,
  P_APP,
]

export function loginNewDeviceVarsByName(vars: LoginNewDeviceTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of LOGIN_NEW_DEVICE_PLACEHOLDERS) out[p.name] = vars[p.varKey]
  return out
}

export const LOGIN_NEW_DEVICE_TEMPLATE_DEFAULTS: TemplateFields = {
  subject: '【{{サービス名}}】新しい端末からログインがありました',
  heading: '新しい端末からのログイン',
  body: [
    '{{日時}} に、{{ブラウザ}} から {{メールアドレス}} のアカウントにログインがありました。',
    '',
    '心当たりがある場合は、このメールは無視してください。',
    '',
    '心当たりがない場合は、すぐにパスワードを変更してください。',
  ].join('\n'),
  cta_label: 'パスワードを変更する',
  note: '',
}

export const LOGIN_NEW_DEVICE_TEMPLATE_META = {
  label: '新しい端末からのログイン',
  description: '登録済みの端末（ブラウザ）以外から初めてログインしたときに、本人に届く通知メール',
  accent: '#4f46e5',
} as const

export function renderLoginNewDeviceEmail(input: {
  fields: TemplateFields
  vars: LoginNewDeviceTemplateVars
  ctaUrl: string
}): RenderedEmail {
  return renderSimpleEmail({
    appName: input.vars.appName,
    accent: LOGIN_NEW_DEVICE_TEMPLATE_META.accent,
    fields: input.fields,
    vars: loginNewDeviceVarsByName(input.vars),
    ctaUrl: input.ctaUrl,
  })
}

/**
 * User-Agent からブラウザ・OS を簡易判定する（ライブラリは足さない）。
 * 精度より「だいたい合っていて、パースエラーで通知が止まらない」ことを優先する。
 */
export function formatBrowserLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''

  let browser = 'その他のブラウザ'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/CriOS\//.test(ua)) browser = 'Chrome'
  else if (/FxiOS\//.test(ua)) browser = 'Firefox'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari'

  let os = 'その他のOS'
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iPhone'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Linux/.test(ua)) os = 'Linux'

  if (!ua) return 'その他のブラウザ (その他のOS)'
  return `${browser} (${os})`
}

/**
 * JST の日時ラベル（例: 2026年9月7日 10:05）を組み立てる。
 * `jstNowValue` は jstNow() の返り値（ローカル getter が JST 成分を返す Date）を渡すこと。
 */
export function formatJstDateTimeLabel(jstNowValue: Date): string {
  const y = jstNowValue.getFullYear()
  const m = jstNowValue.getMonth() + 1
  const d = jstNowValue.getDate()
  const hh = String(jstNowValue.getHours()).padStart(2, '0')
  const mm = String(jstNowValue.getMinutes()).padStart(2, '0')
  return `${y}年${m}月${d}日 ${hh}:${mm}`
}
