import { Resend } from 'resend'

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

function getFromEmail(): string {
  return process.env.FROM_EMAIL || 'noreply@taskapp.example.com'
}

function getAppName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME || 'TaskApp'
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

// HTMLエスケープ関数（XSS対策）
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

// URL用のエスケープ（属性値に安全に埋め込む）
function escapeUrlForHtml(url: string): string {
  return escapeHtml(url)
}

export interface SendInviteEmailParams {
  to: string
  inviterName: string
  orgName: string
  spaceName: string
  role: 'client' | 'member'
  token: string
  expiresAt: string
}

export async function sendInviteEmail(params: SendInviteEmailParams) {
  const { to, inviterName, orgName, spaceName, role, token, expiresAt } = params

  const appUrl = getAppUrl()
  const appName = getAppName()

  // クライアントと内部メンバーで異なるURLとテンプレート
  const isClient = role === 'client'
  const inviteUrl = isClient
    ? `${appUrl}/portal/${token}`
    : `${appUrl}/invite/${token}`

  const subject = isClient
    ? `【${appName}】${orgName} からプロジェクトへの招待`
    : `【${appName}】${orgName} のチームに招待されました`

  const expiresDate = new Date(expiresAt).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const html = isClient
    ? generateClientInviteHtml({
        appName,
        inviterName,
        orgName,
        spaceName,
        inviteUrl,
        expiresDate,
      })
    : generateMemberInviteHtml({
        appName,
        inviterName,
        orgName,
        spaceName,
        inviteUrl,
        expiresDate,
      })

  const text = isClient
    ? generateClientInviteText({
        appName,
        inviterName,
        orgName,
        spaceName,
        inviteUrl,
        expiresDate,
      })
    : generateMemberInviteText({
        appName,
        inviterName,
        orgName,
        spaceName,
        inviteUrl,
        expiresDate,
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
      console.error('Failed to send invite email:', error)
      throw new Error(`Email send failed: ${error.message}`)
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error('Email service error:', err)
    throw err
  }
}

// クライアント向け招待メール HTML
function generateClientInviteHtml(params: {
  appName: string
  inviterName: string
  orgName: string
  spaceName: string
  inviteUrl: string
  expiresDate: string
}) {
  // XSS対策: ユーザー入力値をエスケープ
  const appName = escapeHtml(params.appName)
  const inviterName = escapeHtml(params.inviterName)
  const orgName = escapeHtml(params.orgName)
  const spaceName = escapeHtml(params.spaceName)
  const inviteUrl = escapeUrlForHtml(params.inviteUrl)
  const expiresDate = escapeHtml(params.expiresDate)

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #f59e0b; padding: 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${appName}</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 24px 0; color: #111827; font-size: 20px; font-weight: 600;">
                プロジェクトへの招待
              </h2>
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 16px; line-height: 1.6;">
                ${inviterName} さんが、${orgName} の「${spaceName}」プロジェクトにあなたを招待しました。
              </p>
              <p style="margin: 0 0 32px 0; color: #374151; font-size: 16px; line-height: 1.6;">
                クライアントポータルから、タスクの確認・コメント・承認を行うことができます。
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}" style="display: inline-block; background-color: #f59e0b; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                      ポータルにアクセス
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 32px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                この招待リンクは <strong>${expiresDate}</strong> まで有効です。
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                このメールに心当たりがない場合は、無視してください。
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

// 内部メンバー向け招待メール HTML
function generateMemberInviteHtml(params: {
  appName: string
  inviterName: string
  orgName: string
  spaceName: string
  inviteUrl: string
  expiresDate: string
}) {
  // XSS対策: ユーザー入力値をエスケープ
  const appName = escapeHtml(params.appName)
  const inviterName = escapeHtml(params.inviterName)
  const orgName = escapeHtml(params.orgName)
  const spaceName = escapeHtml(params.spaceName)
  const inviteUrl = escapeUrlForHtml(params.inviteUrl)
  const expiresDate = escapeHtml(params.expiresDate)

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #4f46e5; padding: 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${appName}</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 24px 0; color: #111827; font-size: 20px; font-weight: 600;">
                チームへの招待
              </h2>
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 16px; line-height: 1.6;">
                ${inviterName} さんが、${orgName} の「${spaceName}」プロジェクトにあなたをメンバーとして招待しました。
              </p>
              <p style="margin: 0 0 32px 0; color: #374151; font-size: 16px; line-height: 1.6;">
                招待を承諾すると、タスクの作成・編集・管理を行うことができます。
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                      招待を承諾する
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 32px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                この招待リンクは <strong>${expiresDate}</strong> まで有効です。
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                このメールに心当たりがない場合は、無視してください。
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

// クライアント向けテキスト版
function generateClientInviteText(params: {
  appName: string
  inviterName: string
  orgName: string
  spaceName: string
  inviteUrl: string
  expiresDate: string
}) {
  const { appName, inviterName, orgName, spaceName, inviteUrl, expiresDate } = params

  return `
${appName} - プロジェクトへの招待

${inviterName} さんが、${orgName} の「${spaceName}」プロジェクトにあなたを招待しました。

クライアントポータルから、タスクの確認・コメント・承認を行うことができます。

ポータルにアクセス:
${inviteUrl}

この招待リンクは ${expiresDate} まで有効です。

---
このメールに心当たりがない場合は、無視してください。
  `.trim()
}

// 内部メンバー向けテキスト版
function generateMemberInviteText(params: {
  appName: string
  inviterName: string
  orgName: string
  spaceName: string
  inviteUrl: string
  expiresDate: string
}) {
  const { appName, inviterName, orgName, spaceName, inviteUrl, expiresDate } = params

  return `
${appName} - チームへの招待

${inviterName} さんが、${orgName} の「${spaceName}」プロジェクトにあなたをメンバーとして招待しました。

招待を承諾すると、タスクの作成・編集・管理を行うことができます。

招待を承諾する:
${inviteUrl}

この招待リンクは ${expiresDate} まで有効です。

---
このメールに心当たりがない場合は、無視してください。
  `.trim()
}
