/**
 * メール通知（日次まとめ）の送信関数。
 * pg_cron → /api/cron/notification-digest から、受信者ごとに1通のダイジェストとして送信する。
 * テンプレートは React Email コンポーネント (templates/NotificationDigestEmail.tsx)。
 * 中身の組み立ては lib/notifications/digest.ts の buildDigest が担う（本関数は送信のみ）。
 */
import { createElement } from 'react'
import { Resend } from 'resend'
import { render } from '@react-email/components'
import NotificationDigestEmail from './templates/NotificationDigestEmail'
import type { DigestSection } from '@/lib/notifications/digest'

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

export interface SendNotificationDigestEmailParams {
  to: string
  displayName: string | null
  sections: DigestSection[]
  totalCount: number
  appUrl?: string
  appName?: string
}

export async function sendNotificationDigestEmail(params: SendNotificationDigestEmailParams) {
  const { to, displayName, sections, totalCount } = params
  const appUrl = params.appUrl || getAppUrl()
  const appName = params.appName || getAppName()
  const settingsUrl = `${appUrl}/settings/notifications`

  const subject = `【${appName}】今日の更新が${totalCount}件あります`

  const emailElement = createElement(NotificationDigestEmail, {
    appName,
    displayName,
    sections,
    totalCount,
    appUrl,
    settingsUrl,
  })
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
      console.error('Failed to send notification digest email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
