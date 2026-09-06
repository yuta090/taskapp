/**
 * 無料50通到達アップグレード促しメール（事務所の owner/admin 宛・本命の有料導線）。
 * ⚠ これは事務所側にだけ届くプライベートなメール。相手先グループには一切営業文言を出さない
 *   （グループへは freeCapNudge.ts の中立1行のみ）。他の簡易メール(src/lib/email/index.ts)と同様、
 *   React Email は使わず素の HTML/テキストで送る。
 */
import { Resend } from 'resend'
import { jstNow } from '@/lib/datetime/jstNow'
import { PLAN_LIMITS } from '@/lib/billing/entitlements'
import { nextMonthResetLabel, renderCapReachedEmail } from './templates/capReached'
import { loadEmailTemplate } from './templates/loadEmailTemplate'

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

export interface SendFreeCapUpgradeEmailParams {
  to: string
  orgName: string
  /** 今月の無料通知枠（通）。省略時は Free プランの枠（PLAN_LIMITS） */
  limit?: number
}

export async function sendFreeCapUpgradeEmail(params: SendFreeCapUpgradeEmailParams) {
  const { to, orgName } = params
  const appName = getAppName()
  const ctaUrl = `${getAppUrl()}/settings/billing`

  // 文面は運営が管理画面で編集したもの（email_templates）。未保存ならコード既定
  const fields = await loadEmailTemplate('free_cap_upgrade')
  const { subject, html, text } = renderCapReachedEmail({
    key: 'free_cap_upgrade',
    fields,
    vars: {
      orgName,
      limitLabel: String(params.limit ?? PLAN_LIMITS.free.monthlySharedPushQuota ?? ''),
      resetDateLabel: nextMonthResetLabel(jstNow()),
      appName,
    },
    ctaUrl,
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
      console.error('Failed to send free-cap upgrade email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
