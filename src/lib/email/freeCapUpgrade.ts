/**
 * 無料50通到達アップグレード促しメール（事務所の owner/admin 宛・本命の有料導線）。
 * ⚠ これは事務所側にだけ届くプライベートなメール。相手先グループには一切営業文言を出さない
 *   （グループへは freeCapNudge.ts の中立1行のみ）。他の簡易メール(src/lib/email/index.ts)と同様、
 *   React Email は使わず素の HTML/テキストで送る。
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

export interface SendFreeCapUpgradeEmailParams {
  to: string
  orgName: string
}

export async function sendFreeCapUpgradeEmail(params: SendFreeCapUpgradeEmailParams) {
  const { to, orgName } = params
  const appName = getAppName()
  const billingUrl = `${getAppUrl()}/settings/billing`

  const subject = `【${appName}】今月の無料通知枠に達しました（Proで送信枠拡大・即時通知）`

  const safeOrgName = escapeHtml(orgName)
  const safeBillingUrl = escapeHtml(billingUrl)

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <tr><td style="background-color:#4f46e5;padding:24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${appName}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px 0;color:#111827;font-size:18px;font-weight:600;">今月の無料通知枠（50通）に達しました</h2>
          <p style="margin:0 0 12px 0;color:#374151;font-size:14px;line-height:1.6;">
            ${safeOrgName} の共通LINE自動通知が、今月の上限（50通）に達しました。以降の自動通知は翌月まで停止します。
            （相手先とのやり取りへの個別返信は引き続きご利用いただけます。）
          </p>
          <p style="margin:0 0 8px 0;color:#374151;font-size:14px;line-height:1.6;">Proにアップグレードすると：</p>
          <ul style="margin:0 0 24px 0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
            <li>送信枠の拡大（上限で止まらない）</li>
            <li>即時通知（日次まとめを待たない）</li>
            <li>自社LINE（事務所名で相手先に届く・白ラベル）</li>
          </ul>
          <table cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${safeBillingUrl}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">プランを確認する</a>
          </td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim()

  const text =
    `${appName} - 今月の無料通知枠（50通）に達しました\n\n` +
    `${orgName} の共通LINE自動通知が、今月の上限（50通）に達しました。以降の自動通知は翌月まで停止します。\n` +
    `（相手先とのやり取りへの個別返信は引き続きご利用いただけます。）\n\n` +
    `Proにアップグレードすると：\n` +
    `・送信枠の拡大（上限で止まらない）\n` +
    `・即時通知（日次まとめを待たない）\n` +
    `・自社LINE（事務所名で相手先に届く・白ラベル）\n\n` +
    `プランを確認する: ${billingUrl}\n`

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
