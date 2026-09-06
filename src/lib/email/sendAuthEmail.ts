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
  user: { id?: string; email: string }
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
  messageId?: string
  templateKey: string | null
}

export async function sendAuthEmail(payload: AuthEmailHookPayload): Promise<SendAuthEmailResult> {
  const { user, email_data: d } = payload
  if (!user?.email) throw new Error('recipient email is missing')
  const appName = getAppName()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')

  const key = authTemplateKeyFor(d.email_action_type)
  let subject: string
  let html: string | undefined
  let text: string

  if (key) {
    // 新しいアドレス宛のメール変更確認だけは token_hash_new を使う
    const isNew = d.email_action_type === 'email_change_new'
    const actionUrl = buildVerifyUrl({
      supabaseUrl,
      tokenHash: isNew && d.token_hash_new ? d.token_hash_new : d.token_hash,
      type: isNew ? 'email_change' : d.email_action_type,
      redirectTo: d.redirect_to ?? '',
    })
    const fields = (await loadEmailTemplate(key).catch(() => null)) ?? AUTH_TEMPLATE_DEFAULTS[key]
    const rendered = renderAuthEmail({
      key,
      fields,
      vars: { email: user.email, token: isNew && d.token_new ? d.token_new : d.token, appName },
      actionUrl,
    })
    subject = rendered.subject
    html = rendered.html
    text = rendered.text
  } else {
    // 未対応の種類（再認証コード等）: 確認コードだけ届ける簡易文面（編集対象外）
    subject = `【${appName}】確認コード`
    text = `${appName} の確認コード: ${d.token}\n\nこのコードを画面に入力してください。心当たりがない場合は無視してください。`
  }

  const resend = getResendClient()
  const { data, error } = await resend.emails.send({
    from: getFromEmail(),
    to: user.email,
    subject,
    ...(html ? { html, text } : { text }),
  })
  if (error) {
    console.error('Failed to send auth email:', error)
    throw new Error(`Email send failed: ${error.message}`)
  }
  return { success: true, messageId: data?.id, templateKey: key }
}
