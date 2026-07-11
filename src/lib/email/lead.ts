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

export interface SendLeadNotificationEmailParams {
  source: string
  email: string
  name?: string
  company?: string
  message?: string
  extra?: Record<string, string>
}

// ステップフォーム等の追加回答キー → 通知メールでの見出し
const EXTRA_LABELS: Record<string, string> = {
  partnerCount: 'やり取りする相手の件数',
  channels: 'いまの連絡手段',
  pain: '困っていること',
  preferredSlots: '相談希望日時の候補',
  teamSize: 'チーム人数',
  currentTool: '現在のツール',
}

/**
 * LP/contactフォームからのリードを運営者へ通知する。
 * 宛先は LEAD_NOTIFY_EMAIL（未設定時は FROM_EMAIL 宛て）。
 */
export async function sendLeadNotificationEmail(params: SendLeadNotificationEmailParams) {
  const to = process.env.LEAD_NOTIFY_EMAIL || process.env.FROM_EMAIL
  if (!to) {
    throw new Error('LEAD_NOTIFY_EMAIL / FROM_EMAIL is not configured')
  }
  const from = process.env.FROM_EMAIL || to

  const rows: Array<[string, string | undefined]> = [
    ['流入元', params.source],
    ['お名前', params.name],
    ['会社名', params.company],
    ['メール', params.email],
    ['メッセージ', params.message],
    ...Object.entries(params.extra ?? {}).map(
      ([key, value]): [string, string | undefined] => [EXTRA_LABELS[key] ?? key, value]
    ),
  ]
  const html = `
    <h2>新しい相談リード（${escapeHtml(params.source)}）</h2>
    <table cellpadding="6" style="border-collapse:collapse">
      ${rows
        .filter(([, v]) => v)
        .map(
          ([k, v]) =>
            `<tr><td style="border:1px solid #ddd;font-weight:bold">${escapeHtml(k)}</td><td style="border:1px solid #ddd">${escapeHtml(v as string).replace(/\n/g, '<br>')}</td></tr>`
        )
        .join('')}
    </table>`

  await getResendClient().emails.send({
    from,
    to,
    replyTo: params.email,
    subject: `【リード】${params.source}: ${params.company || params.name || params.email}`,
    html,
  })
}
