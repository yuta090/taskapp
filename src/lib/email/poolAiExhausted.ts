/**
 * プールAI(当社鍵)の当月org別原価上限到達を、事務所の owner/admin に知らせるメール。
 * ⚠ これは Pro の内部運用事情。相手先(顧客)には一切出さない（事務所側の owner/admin 宛のみ）。
 *   復旧手段＝自社AIキーの登録（/settings/org-integrations）で即時復旧する、を主導線にする。
 *   他の簡易メール(src/lib/email/index.ts)と同様、React Email は使わず素の HTML/テキストで送る。
 */
import { Resend } from 'resend'
import { jstNow } from '@/lib/datetime/jstNow'
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

export interface SendPoolAiExhaustedEmailParams {
  to: string
  orgName: string
}

export async function sendPoolAiExhaustedEmail(params: SendPoolAiExhaustedEmailParams) {
  const { to, orgName } = params
  const appName = getAppName()
  const ctaUrl = `${getAppUrl()}/settings/org-integrations`

  // 文面は運営が管理画面で編集したもの（email_templates）。未保存ならコード既定
  const fields = await loadEmailTemplate('pool_ai_exhausted')
  const { subject, html, text } = renderCapReachedEmail({
    key: 'pool_ai_exhausted',
    fields,
    vars: {
      orgName,
      limitLabel: '',
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
      console.error('Failed to send pool-ai-exhausted email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
