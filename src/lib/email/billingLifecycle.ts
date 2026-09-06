/**
 * 課金ライフサイクルメール（有料開始・支払い失敗・解約）の送信。
 * 文面は運営が管理画面で編集したもの（email_templates）。未保存ならコード既定。
 * 宛先の解決と「遷移したときだけ送る」判断は src/lib/billing/billingLifecycleNotify.ts が担う。
 */
import { Resend } from 'resend'
import { renderBillingLifecycleEmail, type BillingTemplateKey, type BillingTemplateVars } from './templates/billingLifecycle'
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

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export interface SendBillingLifecycleEmailParams {
  to: string
  key: BillingTemplateKey
  orgName: string
  planLabel: string
  nextBillingDateLabel?: string
}

export async function sendBillingLifecycleEmail(params: SendBillingLifecycleEmailParams) {
  const { to, key, orgName, planLabel } = params
  const appName = getAppName()
  const vars: BillingTemplateVars = { orgName, planLabel, nextBillingDateLabel: params.nextBillingDateLabel ?? '', appName }
  const fields = await loadEmailTemplate(key)
  const { subject, html, text } = renderBillingLifecycleEmail({ key, fields, vars, ctaUrl: `${getAppUrl()}/settings/billing` })

  const resend = getResendClient()
  const { data, error } = await resend.emails.send({ from: getFromEmail(), to, subject, html, text })
  if (error) {
    console.error('Failed to send billing lifecycle email:', error)
    throw new Error(`Email send failed: ${error.message}`)
  }
  return { success: true, messageId: data?.id }
}
