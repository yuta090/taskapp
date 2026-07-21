/**
 * プールAI(当社鍵)の当月org別原価上限到達を、事務所の owner/admin に知らせるメール。
 * ⚠ これは Pro の内部運用事情。相手先(顧客)には一切出さない（事務所側の owner/admin 宛のみ）。
 *   復旧手段＝自社AIキーの登録（/settings/org-integrations）で即時復旧する、を主導線にする。
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

export interface SendPoolAiExhaustedEmailParams {
  to: string
  orgName: string
}

export async function sendPoolAiExhaustedEmail(params: SendPoolAiExhaustedEmailParams) {
  const { to, orgName } = params
  const appName = getAppName()
  const settingsUrl = `${getAppUrl()}/settings/org-integrations`

  const subject = `【${appName}】プールAIの今月の上限に達しました（自社AIキー登録で即時復旧）`

  const safeOrgName = escapeHtml(orgName)
  const safeSettingsUrl = escapeHtml(settingsUrl)

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
          <h2 style="margin:0 0 16px 0;color:#111827;font-size:18px;font-weight:600;">プールAIの今月の上限に達しました</h2>
          <p style="margin:0 0 12px 0;color:#374151;font-size:14px;line-height:1.6;">
            ${safeOrgName} で共有提供しているAI（当社のAIキー）が、今月の利用上限に達しました。
            そのため、チャットからの自動タスク抽出が一時的に停止しています。
          </p>
          <p style="margin:0 0 12px 0;color:#374151;font-size:14px;line-height:1.6;">
            <strong>自社のAIキーを登録すると、その場で復旧します</strong>（上限の影響を受けなくなります）。
            登録は設定画面から数分で完了します。
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${safeSettingsUrl}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">AIキーを登録する</a>
          </td></tr></table>
          <p style="margin:24px 0 0 0;color:#9ca3af;font-size:12px;line-height:1.6;">
            ※ 登録しない場合も、翌月には自動的に上限がリセットされ再開します。
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim()

  const text =
    `${appName} - プールAIの今月の上限に達しました\n\n` +
    `${orgName} で共有提供しているAI（当社のAIキー）が、今月の利用上限に達しました。\n` +
    `そのため、チャットからの自動タスク抽出が一時的に停止しています。\n\n` +
    `自社のAIキーを登録すると、その場で復旧します（上限の影響を受けなくなります）。\n` +
    `AIキーを登録する: ${settingsUrl}\n\n` +
    `※ 登録しない場合も、翌月には自動的に上限がリセットされ再開します。\n`

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
