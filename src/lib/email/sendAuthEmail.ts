/**
 * 認証メール（会員登録の確認・パスワード再設定・ログイン用リンク・メール変更確認）の送信。
 * Supabase Auth の Send Email Hook（POST /api/auth/send-email-hook）から呼ばれる。
 * 文面は運営が管理画面で編集したもの（email_templates）。未保存ならコード既定。
 * テンプレートの無い種類（再認証コード等）は、確認コードだけの簡易文面で送る（届かないより良い）。
 */
import { Resend } from 'resend'
import { AUTH_TEMPLATE_DEFAULTS, authTemplateKeyFor, buildVerifyUrl, renderAuthEmail } from './templates/authEmail'
import { loadEmailTemplate } from './templates/loadEmailTemplate'

let resendClient: Resend | null = null
function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
    resendClient = new Resend(apiKey)
  }
  return resendClient
}

let fromEmailWarned = false
function getFromEmail(): string {
  const fromEmail = process.env.FROM_EMAIL
  if (!fromEmail && !fromEmailWarned) {
    console.warn('[email] FROM_EMAIL が未設定です。本番ではメールが届かない可能性があります。')
    fromEmailWarned = true
  }
  return fromEmail || 'noreply@taskapp.example.com'
}

function getAppName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME || 'AgentPM'
}

/** Supabase Send Email Hook の payload のうち使う部分 */
export interface AuthEmailHookPayload {
  /** new_email はメール変更のとき（変更先）。Supabase の User に含まれる */
  user: { id?: string; email: string; new_email?: string }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url?: string
    token_new?: string
    token_hash_new?: string
  }
}

export interface SendAuthEmailResult {
  success: true
  /** 送った通数（メール変更は旧・新で2） */
  sent: number
  templateKey: string | null
}

/** Resend の応答をこれ以上待たない（Supabase の Hook タイムアウトより先に返すため） */
const SEND_TIMEOUT_MS = 8_000

async function sendWithTimeout(input: { to: string; subject: string; html?: string; text: string }) {
  const resend = getResendClient()
  const send = resend.emails.send({ from: getFromEmail(), to: input.to, subject: input.subject, ...(input.html ? { html: input.html, text: input.text } : { text: input.text }) })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Email send timed out after ${SEND_TIMEOUT_MS}ms`)), SEND_TIMEOUT_MS)
  })
  try {
    const { error } = await Promise.race([send, timeout])
    if (error) {
      console.error('Failed to send auth email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function sendAuthEmail(payload: AuthEmailHookPayload): Promise<SendAuthEmailResult> {
  const { user, email_data: d } = payload
  if (!user?.email) throw new Error('recipient email is missing')
  const appName = getAppName()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')

  const key = authTemplateKeyFor(d.email_action_type)

  if (!key) {
    // 未対応の種類（再認証コード等）: 確認コードだけ届ける簡易文面（編集対象外）。トークンはログに出さない
    console.warn('[send-email-hook] unhandled email_action_type:', d.email_action_type)
    if (!d.token) throw new Error(`no token for unhandled email_action_type: ${d.email_action_type}`)
    await sendWithTimeout({
      to: user.email,
      subject: `【${appName}】確認コード`,
      text: `${appName} の確認コード: ${d.token}\n\nこのコードを画面に入力してください。心当たりがない場合は無視してください。`,
    })
    return { success: true, sent: 1, templateKey: null }
  }

  const fields = (await loadEmailTemplate(key).catch(() => null)) ?? AUTH_TEMPLATE_DEFAULTS[key]
  const type = d.email_action_type === 'email' ? 'magiclink' : d.email_action_type

  // メール変更は Supabase が Hook を1回しか呼ばず、旧アドレス用(token_hash)と新アドレス用(token_hash_new)の両方を渡してくる。
  // 既定（secure email change）では両方の確認で変更が完了するので、こちらで2通に分けて送る
  const targets: Array<{ to: string; tokenHash: string; token: string }> = []
  if (key === 'auth_email_change') {
    if (d.token_hash) targets.push({ to: user.email, tokenHash: d.token_hash, token: d.token })
    if (user.new_email && d.token_hash_new) targets.push({ to: user.new_email, tokenHash: d.token_hash_new, token: d.token_new ?? '' })
    if (targets.length === 0) throw new Error('email_change without token_hash')
  } else {
    targets.push({ to: user.email, tokenHash: d.token_hash, token: d.token })
  }

  for (const t of targets) {
    const actionUrl = buildVerifyUrl({ supabaseUrl, tokenHash: t.tokenHash, type, redirectTo: d.redirect_to ?? '' })
    const rendered = renderAuthEmail({
      key,
      fields,
      vars: { email: user.email, newEmail: user.new_email ?? '', token: t.token, appName },
      actionUrl,
    })
    await sendWithTimeout({ to: t.to, subject: rendered.subject, html: rendered.html, text: rendered.text })
  }
  return { success: true, sent: targets.length, templateKey: key }
}
