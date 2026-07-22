/**
 * 共通LINE(共有Bot)の利用申込が入ったことを運営(superadmin)へ知らせるメール。
 *
 * ⚠ 顧客には送らない。運営の承認キュー（/admin/shared-bot-access）へ誘導するための内部通知。
 *   これが無いと「申し込んだのに誰も気づかない」＝開通が止まり顧客を失う。
 *   他の簡易メール(src/lib/email/index.ts)と同様、React Email は使わず素の HTML/テキストで送る。
 */
import { Resend } from 'resend'

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

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char] || char)
}

export interface SendSharedBotAccessRequestedEmailParams {
  to: string
  orgName: string
  orgId: string
}

export async function sendSharedBotAccessRequestedEmail(
  params: SendSharedBotAccessRequestedEmailParams,
) {
  const { to, orgName, orgId } = params
  const appName = getAppName()
  const queueUrl = `${getAppUrl()}/admin/shared-bot-access`

  const subject = `【${appName}】共通LINEの開通申込：${orgName}`

  const safeOrgName = escapeHtml(orgName)
  const safeOrgId = escapeHtml(orgId)
  const safeQueueUrl = escapeHtml(queueUrl)

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <tr><td style="background-color:#4f46e5;padding:24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${appName} 運営通知</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px 0;color:#111827;font-size:18px;font-weight:600;">共通LINEの開通申込が届きました</h2>
          <p style="margin:0 0 12px 0;color:#374151;font-size:14px;line-height:1.6;">
            <strong>${safeOrgName}</strong> から共通LINE（共有アカウント）の利用申込がありました。
            承認するまで、この事務所は共通LINEでの自動通知を利用できません。
          </p>
          <p style="margin:0 0 24px 0;color:#6b7280;font-size:12px;line-height:1.6;">組織ID: ${safeOrgId}</p>
          <table cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${safeQueueUrl}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">承認画面を開く</a>
          </td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim()

  const text =
    `${appName} 運営通知 - 共通LINEの開通申込が届きました\n\n` +
    `${orgName} から共通LINE（共有アカウント）の利用申込がありました。\n` +
    `承認するまで、この事務所は共通LINEでの自動通知を利用できません。\n\n` +
    `組織ID: ${orgId}\n\n` +
    `承認画面: ${queueUrl}\n`

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
      console.error('Failed to send shared-bot-access requested email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
