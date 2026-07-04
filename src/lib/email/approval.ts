/**
 * メール承認送信関数
 * ボールがクライアントに移動した際に、ワンクリック承認メールを送信する
 * テンプレートは React Email コンポーネント (templates/ApprovalEmail.tsx) を使用
 */
import { createElement } from 'react'
import { Resend } from 'resend'
import { render } from '@react-email/components'
import ApprovalEmail from './templates/ApprovalEmail'

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

// 日付文字列を YYYY/M/D 形式に整形する（toISOString は使わずローカル日時を維持）
function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}/${month}/${day}`
}

function getAppName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME || 'AgentPM'
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export interface SendApprovalEmailParams {
  to: string
  token: string
  taskTitle: string
  spaceName: string
  orgName: string
  actionType: 'approve' | 'estimate_approve'
  estimatedCost?: number | null
  dueDate?: string | null
  descriptionExcerpt?: string | null
}

export async function sendApprovalEmail(params: SendApprovalEmailParams) {
  const { to, token, taskTitle, spaceName, orgName, actionType, estimatedCost, dueDate, descriptionExcerpt } = params

  const appUrl = getAppUrl()
  const appName = getAppName()

  const actionUrl = `${appUrl}/portal/email-action/${token}`
  const portalUrl = `${appUrl}/portal`

  const isEstimate = actionType === 'estimate_approve'

  const subject = isEstimate
    ? `【${appName}】見積もりの確認をお願いします — ${taskTitle}`
    : `【${appName}】確認をお願いします — ${taskTitle}`

  const emailProps = {
    appName,
    taskTitle,
    spaceName,
    orgName,
    actionUrl,
    portalUrl,
    actionType,
    estimatedCost,
    dueDateLabel: dueDate ? formatDueDate(dueDate) : null,
    descriptionExcerpt: descriptionExcerpt || null,
  }

  // React Email コンポーネントから HTML + プレーンテキストを生成
  const emailElement = createElement(ApprovalEmail, emailProps)
  const html = await render(emailElement)
  const text = await render(emailElement, { plainText: true })

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
      console.error('Failed to send approval email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
