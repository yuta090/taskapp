/**
 * クライアント滞留リマインドメール送信関数
 * pg_cron → /api/cron/client-reminders から、受信者ごとに1通のダイジェストとして送信される。
 * テンプレートは React Email コンポーネント (templates/ReminderEmail.tsx) を使用
 */
import { createElement } from 'react'
import { Resend } from 'resend'
import { render } from '@react-email/components'
import ReminderEmail from './templates/ReminderEmail'
import type { ReminderTaskRef } from '@/lib/reminders/computeClientReminders'

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

export interface ReminderDigestParam {
  overdue: ReminderTaskRef[]
  dueToday: ReminderTaskRef[]
  stalled: ReminderTaskRef[]
}

export interface SendReminderEmailParams {
  to: string
  displayName: string | null
  digest: ReminderDigestParam
  appUrl?: string
  appName?: string
}

export async function sendReminderEmail(params: SendReminderEmailParams) {
  const { to, displayName, digest } = params
  const appUrl = params.appUrl || getAppUrl()
  const appName = params.appName || getAppName()

  const { overdue, dueToday, stalled } = digest
  const totalCount = overdue.length + dueToday.length + stalled.length

  const subject = overdue.length > 0
    ? `【${appName}】ご対応待ちのタスクが${totalCount}件あります（期限超過${overdue.length}件）`
    : `【${appName}】ご対応待ちのタスクが${totalCount}件あります`

  const settingsUrl = `${appUrl}/portal/settings`

  const emailElement = createElement(ReminderEmail, {
    appName,
    displayName,
    overdue,
    dueToday,
    stalled,
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
      console.error('Failed to send reminder email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
