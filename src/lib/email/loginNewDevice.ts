/**
 * 新しい端末からの初回ログイン通知メールの送信。
 * 文面は運営が管理画面で編集したもの（email_templates）。未保存ならコード既定。
 * 「新規端末かどうか」の判断・記録は src/lib/auth/loginNotify.ts が担う（ここは送るだけ）。
 */
import { Resend } from 'resend'
import { buildFrom, getAppName } from './from'
import { LOGIN_NEW_DEVICE_TEMPLATE_KEY, renderLoginNewDeviceEmail, type LoginNewDeviceTemplateVars } from './templates/loginNewDevice'
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

export interface SendLoginNewDeviceEmailParams {
  to: string
  dateTimeLabel: string
  browserLabel: string
}

export async function sendLoginNewDeviceEmail(params: SendLoginNewDeviceEmailParams) {
  const { to, dateTimeLabel, browserLabel } = params
  const appName = getAppName()
  const vars: LoginNewDeviceTemplateVars = { dateTimeLabel, browserLabel, email: to, appName }
  const fields = await loadEmailTemplate(LOGIN_NEW_DEVICE_TEMPLATE_KEY)
  const { subject, html, text } = renderLoginNewDeviceEmail({ fields, vars, ctaUrl: `${getAppUrl()}/reset` })

  const resend = getResendClient()
  const { data, error } = await resend.emails.send({ from: buildFrom(), to, subject, html, text })
  if (error) {
    console.error('Failed to send login new device email:', error)
    throw new Error(`Email send failed: ${error.message}`)
  }
  return { success: true, messageId: data?.id }
}
