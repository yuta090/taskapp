import { Resend } from 'resend'

// 遅延初期化でビルド時エラーを回避（index.ts と同パターン）
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

export interface SendTemplateDownloadEmailParams {
  to: string
  /** 配布物の名前（件名・本文に使う） */
  magnetTitle: string
  /** 期限付きの署名ダウンロードURL */
  downloadUrl: string
  /** リンクの有効期限（時間） */
  expiresHours: number
}

/**
 * TASK6 のテンプレ申込者本人へダウンロードリンクを送る。
 * リンクは署名URL（期限付き）。失効後はページから再申込してもらう。
 */
export async function sendTemplateDownloadEmail(params: SendTemplateDownloadEmailParams) {
  const from = process.env.FROM_EMAIL
  if (!from) {
    throw new Error('FROM_EMAIL is not configured')
  }

  const title = escapeHtml(params.magnetTitle)
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2 style="font-size:18px">${title}</h2>
      <p>TASK6（タスクシックス）をご利用いただきありがとうございます。<br>
      ご請求いただいたテンプレートは、下のボタンからダウンロードできます。</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(params.downloadUrl)}"
           style="display:inline-block;background:#f59e0b;color:#fff;font-weight:bold;
                  padding:12px 24px;border-radius:8px;text-decoration:none">
          テンプレートをダウンロード
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">
        このリンクは${params.expiresHours}時間で無効になります。期限が切れた場合は、
        お手数ですがもう一度ダウンロードページからお申し込みください。
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
      <p style="color:#64748b;font-size:12px">
        TASK6 — 仕事がまわる学びのメディア（agentpm.app/task6）
      </p>
    </div>`

  await getResendClient().emails.send({
    from,
    to: params.to,
    subject: `【TASK6】${params.magnetTitle} のダウンロードリンク`,
    html,
  })
}
