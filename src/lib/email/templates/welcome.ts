/**
 * ウェルカムメールのテンプレート
 * 組織作成完了直後に送る、最初の使い方を案内するメール。
 * HTML + プレーンテキスト両対応、独自のXSSエスケープを行う（src/lib/email/index.ts と同じパターン）
 */

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

export interface WelcomeEmailContentParams {
  orgName: string
  appName: string
  appUrl: string
}

export interface WelcomeEmailContent {
  subject: string
  html: string
  text: string
}

export function buildWelcomeEmailContent(params: WelcomeEmailContentParams): WelcomeEmailContent {
  const { appName, appUrl } = params
  const orgNameHtml = escapeHtml(params.orgName)
  const appNameHtml = escapeHtml(appName)
  const loginUrl = `${appUrl}/login`
  const helpUrl = `${appUrl}/help`

  const subject = `【${appName}】ようこそ！最初の3ステップ`

  const html = `
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
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${appNameHtml}</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 24px 0; color: #111827; font-size: 20px; font-weight: 600;">
                ようこそ、${orgNameHtml} 様
              </h2>
              <p style="margin: 0 0 24px 0; color: #374151; font-size: 16px; line-height: 1.6;">
                ${appNameHtml} へのご登録ありがとうございます。まずは以下の3ステップから始めましょう。
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0;">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                    <p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">① 最初のタスクを作成</p>
                    <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">タイトルを入力してEnterを押すだけで作成できます。</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                    <p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">② メンバー・クライアントを招待</p>
                    <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">「設定」→「メンバー」から招待できます。</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0;">
                    <p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">③ タスクをクライアントに公開</p>
                    <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">タスクを「クライアントに公開」すると、ポータルで共有できます。</p>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(loginUrl)}" style="display: inline-block; background-color: #f59e0b; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                      ${appNameHtml} にログイン
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 32px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                使い方でわからないことがあれば、<a href="${escapeHtml(helpUrl)}" style="color: #f59e0b;">ヘルプページ</a>をご覧ください。
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

  const text = `
${appName} - ようこそ！最初の3ステップ

${params.orgName} 様

${appName} へのご登録ありがとうございます。まずは以下の3ステップから始めましょう。

① 最初のタスクを作成
タイトルを入力してEnterを押すだけで作成できます。

② メンバー・クライアントを招待
「設定」→「メンバー」から招待できます。

③ タスクをクライアントに公開
タスクを「クライアントに公開」すると、ポータルで共有できます。

${appName} にログイン:
${loginUrl}

使い方でわからないことがあれば、ヘルプページをご覧ください:
${helpUrl}

---
このメールに心当たりがない場合は、無視してください。
  `.trim()

  return { subject, html, text }
}
