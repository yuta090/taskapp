/**
 * 共有bot code_only 紐付け成立メール（検知的統制・設計正本 §4/§7-8(m)・PR3b）。
 * 人の承認を経ない紐付けのため、成立後にorg owner/adminへ知らせて是正（unlink→新世代）の
 * 手掛かりを与える。新テンプレは最小限（React Emailコンポーネントは使わず、他の簡易メール
 * （src/lib/email/index.ts）と同様の素のHTML/テキストで済ませる）。
 */
import { Resend } from 'resend'

// 遅延初期化でビルド時エラーを回避（他のemailモジュールと同じパターン）
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

// HTMLエスケープ（groupDisplayNameはLINE API由来の非信頼な文字列のため必須）
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

export interface SendGroupClaimLinkedEmailParams {
  to: string
  orgId: string
  orgName: string
  spaceName: string
  groupDisplayName: string
}

export async function sendGroupClaimLinkedEmail(params: SendGroupClaimLinkedEmailParams) {
  const { to, orgId, orgName, spaceName, groupDisplayName } = params
  const appName = getAppName()
  const consoleUrl = `${getAppUrl()}/${orgId}/secretary/connect/line/groups`

  const subject = `【${appName}】共有botグループが「${spaceName}」に紐付きました`

  const safeOrgName = escapeHtml(orgName)
  const safeSpaceName = escapeHtml(spaceName)
  const safeGroupName = escapeHtml(groupDisplayName)
  const safeConsoleUrl = escapeHtml(consoleUrl)

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
          <h2 style="margin:0 0 16px 0;color:#111827;font-size:18px;font-weight:600;">共有botグループが紐付きました</h2>
          <p style="margin:0 0 12px 0;color:#374151;font-size:14px;line-height:1.6;">
            ${safeOrgName} の共有botグループ「${safeGroupName}」が、プロジェクト「${safeSpaceName}」に紐付きました。
          </p>
          <p style="margin:0 0 24px 0;color:#374151;font-size:14px;line-height:1.6;">
            この紐付けは招待コードの投入により自動で成立しました（人による承認は経ていません）。
            心当たりが無い場合は、コンソールから確認のうえ解除してください。
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${safeConsoleUrl}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">コンソールで確認する</a>
          </td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim()

  const text =
    `${appName} - 共有botグループが紐付きました\n\n` +
    `${orgName} の共有botグループ「${groupDisplayName}」が、プロジェクト「${spaceName}」に紐付きました。\n` +
    `この紐付けは招待コードの投入により自動で成立しました（人による承認は経ていません）。\n` +
    `心当たりが無い場合は、コンソールから確認のうえ解除してください。\n\n` +
    `${consoleUrl}\n`

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
      console.error('Failed to send group claim linked email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}
