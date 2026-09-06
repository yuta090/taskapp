/**
 * 招待メールの文面（テンプレート）。
 *
 * 文面は運営が管理画面（/admin/email-templates）で編集でき、DB(email_templates)に保存される。
 * 保存が無いときはここの INVITE_TEMPLATE_DEFAULTS が使われる（= 従来のハードコード文面と同一）。
 *
 * 編集できるのは「件名・見出し・本文・ボタンの文字・ボタン下の補足」の5項目だけ。
 * HTMLの枠（ヘッダ色・ボタン・有効期限行・フッタ）はコード側で固定し、
 * 文面と差し込み値はすべてエスケープするので、運営が何を書いても壊れない／XSSにならない。
 *
 * このモジュールは純粋（DB・Resend に依存しない）。管理画面のプレビューも同じ関数で描く。
 * ※ client bundle からも import されるので、server 専用モジュールをここに入れないこと。
 */
import { escapeHtml, escapeHtmlMultiline, escapeUrlForHtml } from '../escape'

export const INVITE_TEMPLATE_KEYS = ['invite_client', 'invite_member'] as const
export type InviteTemplateKey = (typeof INVITE_TEMPLATE_KEYS)[number]

export function isInviteTemplateKey(v: unknown): v is InviteTemplateKey {
  return typeof v === 'string' && (INVITE_TEMPLATE_KEYS as readonly string[]).includes(v)
}

/** 運営が編集できる5項目 */
export interface InviteTemplateFields {
  /** 件名 */
  subject: string
  /** メール冒頭の見出し */
  heading: string
  /** 本文。空行で段落、単独改行はそのまま改行 */
  body: string
  /** ボタンの文字 */
  cta_label: string
  /** ボタン下の補足（空でよい） */
  note: string
}

export const INVITE_TEMPLATE_FIELD_KEYS = ['subject', 'heading', 'body', 'cta_label', 'note'] as const

/** 差し込みに使える値 */
export interface InviteTemplateVars {
  inviterName: string
  orgName: string
  spaceName: string
  expiresDate: string
  appName: string
}

/** 文面に書ける差し込み語。運営向けなので日本語にしている */
export const INVITE_PLACEHOLDERS: ReadonlyArray<{
  token: string
  name: string
  varKey: keyof InviteTemplateVars
  description: string
  sample: string
}> = [
  { token: '{{招待者名}}', name: '招待者名', varKey: 'inviterName', description: '招待した人の名前', sample: '山田 太郎' },
  { token: '{{組織名}}', name: '組織名', varKey: 'orgName', description: '招待した組織の名前', sample: '株式会社サンプル' },
  { token: '{{プロジェクト名}}', name: 'プロジェクト名', varKey: 'spaceName', description: '招待先のプロジェクト名', sample: 'ホームページ制作' },
  { token: '{{有効期限}}', name: '有効期限', varKey: 'expiresDate', description: '招待リンクの有効期限', sample: '2026年9月14日' },
  { token: '{{サービス名}}', name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' },
]

const PLACEHOLDER_BY_NAME = new Map(INVITE_PLACEHOLDERS.map((p) => [p.name, p.varKey]))

/** 差し込み語の構文 `{{ 名前 }}` */
const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

export const INVITE_TEMPLATE_LIMITS = {
  subject: 200,
  heading: 100,
  body: 4000,
  cta_label: 60,
  note: 500,
} as const

export const INVITE_TEMPLATE_DEFAULTS: Record<InviteTemplateKey, InviteTemplateFields> = {
  invite_client: {
    subject: '【{{サービス名}}】{{組織名}} からプロジェクトへの招待',
    heading: 'プロジェクトへの招待',
    body: [
      '{{招待者名}} さんが、{{組織名}} の「{{プロジェクト名}}」プロジェクトにあなたを招待しました。',
      '',
      'クライアントポータルから、タスクの確認・コメント・承認を行うことができます。',
    ].join('\n'),
    cta_label: 'ポータルにアクセス',
    // HTML では「ボタン」、テキスト版では押せるボタンが無いので両方で通じる表現にしている
    note: 'アカウント登録は不要です。上のリンク（ボタン）からそのままご覧いただけます。',
  },
  invite_member: {
    subject: '【{{サービス名}}】{{組織名}} のチームに招待されました',
    heading: 'チームへの招待',
    body: [
      '{{招待者名}} さんが、{{組織名}} の「{{プロジェクト名}}」プロジェクトにあなたをメンバーとして招待しました。',
      '',
      '招待を承諾すると、タスクの作成・編集・管理を行うことができます。',
      '初めてご利用の場合は、リンク先で無料のアカウント作成をご案内します。',
    ].join('\n'),
    cta_label: '招待を承諾する',
    note: '',
  },
}

/** 画面上の説明（管理画面・プレビュー用） */
export const INVITE_TEMPLATE_META: Record<InviteTemplateKey, { label: string; description: string; accent: string }> = {
  invite_client: {
    label: '相手先への招待',
    description: '相手先（クライアント）をプロジェクトのポータルに招待するときのメール',
    accent: '#f59e0b',
  },
  invite_member: {
    label: 'メンバーへの招待',
    description: '自社のメンバーをチームに招待するときのメール',
    accent: '#4f46e5',
  },
}

/**
 * 文字列内の差し込み語を値に置き換える。知らない差し込み語はそのまま残す。
 * `transform` を渡すと差し込む値に加工（HTMLエスケープ等）をかける。
 */
export function renderTemplateString(
  template: string,
  vars: InviteTemplateVars,
  transform: (value: string) => string = (v) => v,
): string {
  return template.replace(PLACEHOLDER_RE, (whole, name: string) => {
    const varKey = PLACEHOLDER_BY_NAME.get(name)
    if (!varKey) return whole
    return transform(vars[varKey])
  })
}

/** 文面に含まれる差し込み語のうち、知らないものを列挙する */
export function findUnknownPlaceholders(template: string): string[] {
  const unknown = new Set<string>()
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]
    if (!PLACEHOLDER_BY_NAME.has(name)) unknown.add(name)
  }
  return [...unknown]
}

export type ValidateResult =
  | { ok: true; fields: InviteTemplateFields }
  | { ok: false; error: string }

/**
 * 管理画面からの入力を検証して整える（trim・必須・長さ・差し込み語）。
 * 検証は「送ってから気づく」を防ぐためのもので、HTML の安全性はレンダ側のエスケープで担保する。
 */
export function validateInviteTemplateFields(input: unknown): ValidateResult {
  if (!input || typeof input !== 'object') return { ok: false, error: '文面の形式が不正です' }
  const src = input as Record<string, unknown>
  const labels: Record<keyof InviteTemplateFields, string> = {
    subject: '件名',
    heading: '見出し',
    body: '本文',
    cta_label: 'ボタンの文字',
    note: 'ボタン下の補足',
  }
  const out: Partial<InviteTemplateFields> = {}
  for (const key of INVITE_TEMPLATE_FIELD_KEYS) {
    const raw = src[key]
    if (raw === undefined || raw === null) {
      if (key === 'note') {
        out.note = ''
        continue
      }
      return { ok: false, error: `${labels[key]}を入力してください` }
    }
    if (typeof raw !== 'string') return { ok: false, error: `${labels[key]}の形式が不正です` }
    // 本文だけ改行を許す。件名・見出し・ボタン・補足は1行にそろえる（件名に改行が混ざるのを防ぐ）
    const value = key === 'body' ? raw.replace(/\r\n?/g, '\n').trim() : raw.replace(/[\r\n]+/g, ' ').trim()
    if (!value && key !== 'note') return { ok: false, error: `${labels[key]}を入力してください` }
    if (value.length > INVITE_TEMPLATE_LIMITS[key]) {
      return { ok: false, error: `${labels[key]}は${INVITE_TEMPLATE_LIMITS[key]}文字以内にしてください` }
    }
    const unknown = findUnknownPlaceholders(value)
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `${labels[key]}に使えない差し込み語があります: ${unknown.map((n) => `{{${n}}}`).join('、')}`,
      }
    }
    out[key] = value
  }
  return { ok: true, fields: out as InviteTemplateFields }
}

export interface RenderInviteEmailInput {
  variant: 'client' | 'member'
  fields: InviteTemplateFields
  vars: InviteTemplateVars
  inviteUrl: string
  /** 招待者が添えた一言（任意） */
  message?: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** 本文（複数行テキスト）→ 段落ごとの <p>。空行で段落、単独改行は <br> */
function renderBodyHtml(body: string, vars: InviteTemplateVars): string {
  const paragraphs = body.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)
  return paragraphs
    .map(
      (p, i, arr) => `
              <p style="margin: 0 0 ${i === arr.length - 1 ? 32 : 16}px 0; color: #374151; font-size: 16px; line-height: 1.6;">
                ${renderTemplateString(escapeHtmlMultiline(p), vars, escapeHtml)}
              </p>`,
    )
    .join('')
}

function renderMessageQuoteHtml(message: string | undefined): string {
  if (!message) return ''
  return `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0;">
                <tr>
                  <td style="border-left: 3px solid #d1d5db; padding: 12px 16px; background-color: #f9fafb;">
                    <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">${escapeHtmlMultiline(message)}</p>
                  </td>
                </tr>
              </table>`
}

/**
 * 招待メールを組み立てる（件名・HTML・テキスト）。
 * 文面（fields）と差し込み値（vars）は両方エスケープする。文面テンプレート内の
 * 差し込み語 `{{…}}` はエスケープで変化しないので、エスケープ後に置換して問題ない。
 */
export function renderInviteEmail(input: RenderInviteEmailInput): RenderedEmail {
  const { variant, fields, vars, inviteUrl, message } = input
  const accent = variant === 'client' ? INVITE_TEMPLATE_META.invite_client.accent : INVITE_TEMPLATE_META.invite_member.accent

  const subject = renderTemplateString(fields.subject, vars)
  const appName = escapeHtml(vars.appName)
  const heading = renderTemplateString(escapeHtml(fields.heading), vars, escapeHtml)
  const ctaLabel = renderTemplateString(escapeHtml(fields.cta_label), vars, escapeHtml)
  const note = fields.note.trim() ? renderTemplateString(escapeHtmlMultiline(fields.note.trim()), vars, escapeHtml) : ''
  const expiresDate = escapeHtml(vars.expiresDate)
  const url = escapeUrlForHtml(inviteUrl)

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
            <td style="background-color: ${accent}; padding: 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${appName}</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 24px 0; color: #111827; font-size: 20px; font-weight: 600;">
                ${heading}
              </h2>${renderBodyHtml(fields.body, vars)}${renderMessageQuoteHtml(message)}
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${url}" style="display: inline-block; background-color: ${accent}; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>${
                note
                  ? `
              <p style="margin: 16px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5; text-align: center;">
                ${note}
              </p>`
                  : ''
              }
              <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
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

  const textNote = fields.note.trim() ? `\n${renderTemplateString(fields.note.trim(), vars)}\n` : ''
  const text = `
${vars.appName} - ${renderTemplateString(fields.heading, vars)}

${renderTemplateString(fields.body, vars)}
${message ? `\n${message}\n` : ''}
${renderTemplateString(fields.cta_label, vars)}:
${inviteUrl}
${textNote}
この招待リンクは ${vars.expiresDate} まで有効です。

---
このメールに心当たりがない場合は、無視してください。
  `.trim()

  return { subject, html, text }
}
