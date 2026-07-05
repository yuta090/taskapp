/**
 * ウェルカムメール送信関数
 * 組織作成完了直後に、最初の使い方を案内するメールを送信する
 * テンプレートは templates/welcome.ts (HTML文字列 + プレーンテキスト) を使用
 */
import { Resend } from 'resend'
import { buildWelcomeEmailContent } from './templates/welcome'

// 遅延初期化でビルド時エラーを回避
let resendClient: Resend | null = null

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured')
    }
    resendClient = new Resend(apiKey)
  }
  return resendClient
}

// FROM_EMAIL 未設定警告は起動あたり一度だけ出す
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

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export interface SendWelcomeEmailParams {
  to: string
  orgName: string
  dryRun?: boolean
}

export interface SendWelcomeEmailResult {
  success: true
  messageId?: string
  skipped?: boolean
  reason?: 'resend_not_configured' | 'dry_run'
}

export async function sendWelcomeEmail(params: SendWelcomeEmailParams): Promise<SendWelcomeEmailResult> {
  const { to, orgName, dryRun } = params

  // オンボーディングを止めないため、RESEND未設定時は例外を投げずスキップする
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY が未設定のため、ウェルカムメールの送信をスキップしました。')
    return { success: true, skipped: true, reason: 'resend_not_configured' }
  }

  const appUrl = getAppUrl()
  const appName = getAppName()
  const { subject, html, text } = buildWelcomeEmailContent({ orgName, appName, appUrl })

  if (dryRun) {
    return { success: true, skipped: true, reason: 'dry_run' }
  }

  try {
    const resend = getResendClient()
    const { data, error } = await resend.emails.send({
      from: getFromEmail(),
      to,
      subject,
      html,
      text,
    })

    if (error) {
      console.error('Failed to send welcome email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
