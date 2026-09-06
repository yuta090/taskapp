/**
 * 課金ライフサイクルメール（有料開始・支払い失敗・解約）の送信。
 * 文面は運営が管理画面で編集したもの（email_templates）。未保存ならコード既定。
 * 宛先の解決と「遷移したときだけ送る」判断は src/lib/billing/billingLifecycleNotify.ts が担う。
 */
import { Resend } from 'resend'
import { buildFrom, getAppName } from './from'
import { renderBillingLifecycleEmail, type BillingTemplateKey, type BillingTemplateVars } from './templates/billingLifecycle'
import type { TemplateFields } from './templates/core'
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



function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export interface SendBillingLifecycleEmailParams {
  to: string
  key: BillingTemplateKey
  orgName: string
  planLabel: string
  /** 呼び出し側が先に読んだ文面（宛先が複数のとき毎回読まないため）。無ければここで読む */
  fields?: TemplateFields
}

export async function sendBillingLifecycleEmail(params: SendBillingLifecycleEmailParams) {
  const { to, key, orgName, planLabel } = params
  const appName = getAppName()
  const vars: BillingTemplateVars = { orgName, planLabel, appName }
  const fields = params.fields ?? (await loadEmailTemplate(key))
  const { subject, html, text } = renderBillingLifecycleEmail({ key, fields, vars, ctaUrl: `${getAppUrl()}/settings/billing` })

  const resend = getResendClient()
  const { data, error } = await resend.emails.send({ from: buildFrom(), to, subject, html, text })
  if (error) {
    console.error('Failed to send billing lifecycle email:', error)
    throw new Error(`Email send failed: ${error.message}`)
  }
  return { success: true, messageId: data?.id }
}
