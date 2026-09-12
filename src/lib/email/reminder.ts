/**
 * クライアント滞留リマインドメール送信関数
 * pg_cron → /api/cron/client-reminders から、受信者ごとに1通のダイジェストとして送信される。
 * テンプレートは React Email コンポーネント (templates/ReminderEmail.tsx) を使用
 */
import { createElement } from 'react'
import { Resend } from 'resend'
import { buildFrom, getAppName, sanitizeReplyTo } from './from'
import { render } from '@react-email/components'
import ReminderEmail from './templates/ReminderEmail'
import { buildEmailCopy } from './templates/core'
import { reminderKeyFor, reminderVarsByName } from './templates/reminder'
import { loadEmailTemplate } from './templates/loadEmailTemplate'
import type { ReminderTaskRef } from '@/lib/reminders/computeClientReminders'
import { sendEmailWithRetry } from './sendWithRetry'

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



function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export interface ReminderDigestParam {
  overdue: ReminderTaskRef[]
  dueToday: ReminderTaskRef[]
  stalled: ReminderTaskRef[]
}

export interface SendReminderEmailParams {
  /** 差出人表示名に入れる事務所名（有料プランかつ受信者のタスクが1つの事務所に収まるとき）。無ければ AgentPM のみ */
  senderOrgName?: string | null
  /** 返信先（操作した担当者のメール）。相手先が返信すると担当者に届く */
  replyTo?: string | null
  to: string
  displayName: string | null
  digest: ReminderDigestParam
  appUrl?: string
  appName?: string
}

export async function sendReminderEmail(params: SendReminderEmailParams) {
  const { to, displayName, digest, senderOrgName, replyTo } = params
  const appUrl = params.appUrl || getAppUrl()
  const appName = params.appName || getAppName()

  const { overdue, dueToday, stalled } = digest
  const totalCount = overdue.length + dueToday.length + stalled.length

  // 文面は運営が管理画面で編集したもの（email_templates）。未保存ならコード既定
  const fields = await loadEmailTemplate(reminderKeyFor(overdue.length))
  const copy = buildEmailCopy(
    fields,
    reminderVarsByName({
      displayName: displayName ?? '',
      totalCount,
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
      appName,
    }),
  )
  const subject = copy.subject

  const settingsUrl = `${appUrl}/portal/settings`

  const emailElement = createElement(ReminderEmail, {
    appName,
    displayName,
    overdue,
    dueToday,
    stalled,
    appUrl,
    settingsUrl,
    copy,
  })
  const html = await render(emailElement)
  const text = await render(emailElement, { plainText: true })

  try {
    const resend = getResendClient()
    const { data, error } = await sendEmailWithRetry(resend, {
      // 相手先には「{事務所名} (AgentPM)」の名前で届き、返信は操作した担当者へ
      from: buildFrom({ orgName: senderOrgName }),
      replyTo: sanitizeReplyTo(replyTo),
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
