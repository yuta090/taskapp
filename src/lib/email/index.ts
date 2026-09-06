import { Resend } from 'resend'

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

import { renderInviteEmail, type InviteTemplateVars } from './templates/invite'
import { loadInviteTemplate } from './templates/loadInviteTemplate'

export interface SendInviteEmailParams {
  to: string
  inviterName: string
  orgName: string
  spaceName: string
  role: 'client' | 'member'
  token: string
  expiresAt: string
  message?: string
}

/**
 * 招待メールを送る。
 * 文面は運営が管理画面（/admin/email-templates）で編集したもの（email_templates）を使い、
 * 未保存ならコード既定（templates/invite.ts）。HTML の枠と差し込みは renderInviteEmail に集約。
 */
export async function sendInviteEmail(params: SendInviteEmailParams) {
  const { to, inviterName, orgName, spaceName, role, token, expiresAt, message } = params

  const appUrl = getAppUrl()
  const appName = getAppName()

  // クライアントと内部メンバーで異なるURLとテンプレート
  const isClient = role === 'client'
  const inviteUrl = isClient
    ? `${appUrl}/portal/${token}`
    : `${appUrl}/invite/${token}`

  const expiresDate = new Date(expiresAt).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const vars: InviteTemplateVars = { inviterName, orgName, spaceName, expiresDate, appName }
  const fields = await loadInviteTemplate(isClient ? 'invite_client' : 'invite_member')
  const { subject, html, text } = renderInviteEmail({
    variant: isClient ? 'client' : 'member',
    fields,
    vars,
    inviteUrl,
    message,
  })

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
      console.error('Failed to send invite email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
