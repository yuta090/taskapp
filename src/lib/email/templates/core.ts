/**
 * メール文面テンプレートの共通部品（純粋モジュール。DB・Resend に依存しない）。
 *
 * 全テンプレートは同じ5項目（件名・見出し・本文・ボタンの文字・ボタン下の補足）を持ち、
 * 違うのは「差し込み語の集合」「既定文面」「コード固定のスロット」だけ（Fable 裁定 2026-09-07:
 * テンプレごとの編集項目スキーマは作らない）。管理画面はこの5項目のエディタを全キーで使い回す。
 *
 * 安全性: 文面（運営入力）と差し込み値（利用者データ）は両方 HTML エスケープする。
 * 差し込み語 `{{名前}}` はエスケープで変化しないので「エスケープ → 置換」の順で問題ない。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { escapeHtml, escapeHtmlMultiline, escapeUrlForHtml } from '../escape'

/** 運営が編集できる5項目 */
export interface TemplateFields {
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

export const TEMPLATE_FIELD_KEYS = ['subject', 'heading', 'body', 'cta_label', 'note'] as const
export type TemplateFieldKey = (typeof TEMPLATE_FIELD_KEYS)[number]

export const TEMPLATE_FIELD_LABELS: Record<TemplateFieldKey, string> = {
  subject: '件名',
  heading: '見出し',
  body: '本文',
  cta_label: 'ボタンの文字',
  note: 'ボタン下の補足',
}

export const TEMPLATE_LIMITS: Record<TemplateFieldKey, number> = {
  subject: 200,
  heading: 100,
  body: 4000,
  cta_label: 60,
  note: 500,
}

/** 文面に書ける差し込み語。運営向けなので名前は日本語。トークンは `{{名前}}` */
export interface PlaceholderDef {
  name: string
  description: string
  sample: string
}

export function placeholderToken(p: PlaceholderDef | string): string {
  return `{{${typeof p === 'string' ? p : p.name}}}`
}

/** 差し込み値: 差し込み語の名前 → 値 */
export type TemplateVars = Record<string, string>

/** 見本の値（管理画面プレビュー用） */
export function sampleVars(placeholders: readonly PlaceholderDef[]): TemplateVars {
  const vars: TemplateVars = {}
  for (const p of placeholders) vars[p.name] = p.sample
  return vars
}

/** 差し込み語の構文 `{{ 名前 }}` */
const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

/**
 * 文字列内の差し込み語を値に置き換える。vars に無い差し込み語はそのまま残す。
 * `transform` を渡すと差し込む値に加工（HTMLエスケープ等）をかける。
 */
export function renderTemplateString(
  template: string,
  vars: TemplateVars,
  transform: (value: string) => string = (v) => v,
): string {
  return template.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole
    return transform(vars[name])
  })
}

/** 文面に含まれる差し込み語のうち、使えないものを列挙する */
export function findUnknownPlaceholders(template: string, allowedNames: readonly string[]): string[] {
  const allowed = new Set(allowedNames)
  const unknown = new Set<string>()
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    if (!allowed.has(m[1])) unknown.add(m[1])
  }
  return [...unknown]
}

export type ValidateResult = { ok: true; fields: TemplateFields } | { ok: false; error: string }

/**
 * 管理画面からの入力を検証して整える（trim・必須・長さ・差し込み語）。
 * 検証は「送ってから気づく」を防ぐためのもので、HTML の安全性はレンダ側のエスケープで担保する。
 */
export function validateTemplateFields(input: unknown, allowedPlaceholderNames: readonly string[]): ValidateResult {
  if (!input || typeof input !== 'object') return { ok: false, error: '文面の形式が不正です' }
  const src = input as Record<string, unknown>
  const out: Partial<TemplateFields> = {}
  for (const key of TEMPLATE_FIELD_KEYS) {
    const label = TEMPLATE_FIELD_LABELS[key]
    const raw = src[key]
    if (raw === undefined || raw === null) {
      if (key === 'note') {
        out.note = ''
        continue
      }
      return { ok: false, error: `${label}を入力してください` }
    }
    if (typeof raw !== 'string') return { ok: false, error: `${label}の形式が不正です` }
    // 本文だけ改行を許す。件名・見出し・ボタン・補足は1行にそろえる（件名に改行が混ざるのを防ぐ）
    const value = key === 'body' ? raw.replace(/\r\n?/g, '\n').trim() : raw.replace(/[\r\n]+/g, ' ').trim()
    if (!value && key !== 'note') return { ok: false, error: `${label}を入力してください` }
    if (value.length > TEMPLATE_LIMITS[key]) {
      return { ok: false, error: `${label}は${TEMPLATE_LIMITS[key]}文字以内にしてください` }
    }
    const unknown = findUnknownPlaceholders(value, allowedPlaceholderNames)
    if (unknown.length > 0) {
      return { ok: false, error: `${label}に使えない差し込み語があります: ${unknown.map(placeholderToken).join('、')}` }
    }
    out[key] = value
  }
  return { ok: true, fields: out as TemplateFields }
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** コード固定のスロット（HTML とテキスト版の両方） */
export interface FixedSlot {
  html: string
  text: string
}

export interface RenderSimpleEmailInput {
  /** ヘッダに出すサービス名 */
  appName: string
  /** ヘッダ・ボタンの色（トークン外の hex はメールHTML内のみ許容） */
  accent: string
  fields: TemplateFields
  vars: TemplateVars
  ctaUrl: string
  /** 利用者が添えた一言（任意。引用として本文の後に出る） */
  message?: string
  /** 本文（と引用）の後・ボタンの前に入るコード固定部分 */
  beforeCta?: FixedSlot
  /** 補足の後・フッタの前に入るコード固定部分 */
  afterCta?: FixedSlot
}

/** 本文（複数行テキスト）→ 段落ごとの <p>。空行で段落、単独改行は <br>。最後の段落はボタン前の余白を持つ */
function renderBodyHtml(body: string, vars: TemplateVars): string {
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
 * 「ヘッダ → 見出し → 本文 → (引用) → (固定) → ボタン → 補足 → (固定) → フッタ」の枠でメールを組み立てる。
 * 文面（fields）と差し込み値（vars）は両方エスケープする。固定スロットは呼び出し側が責任を持って
 * エスケープ済みの HTML を渡す。
 */
export function renderSimpleEmail(input: RenderSimpleEmailInput): RenderedEmail {
  const { fields, vars, ctaUrl, message, beforeCta, afterCta } = input
  // 今はコード定数だけだが、公開関数なので属性値として無害化しておく
  const accent = escapeHtml(input.accent)

  // 差し込み値（組織名など利用者入力）に改行が入っていても件名は1行にする（ヘッダ崩れ防止）
  const subject = renderTemplateString(fields.subject, vars).replace(/[\r\n]+/g, ' ')
  const appName = escapeHtml(input.appName)
  const heading = renderTemplateString(escapeHtml(fields.heading), vars, escapeHtml)
  const ctaLabel = renderTemplateString(escapeHtml(fields.cta_label), vars, escapeHtml)
  const note = fields.note.trim() ? renderTemplateString(escapeHtmlMultiline(fields.note.trim()), vars, escapeHtml) : ''
  const url = escapeUrlForHtml(ctaUrl)

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
              </h2>${renderBodyHtml(fields.body, vars)}${renderMessageQuoteHtml(message)}${beforeCta?.html ?? ''}
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
              }${afterCta?.html ?? ''}
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
${input.appName} - ${renderTemplateString(fields.heading, vars)}

${renderTemplateString(fields.body, vars)}
${message ? `\n${message}\n` : ''}${beforeCta?.text ?? ''}
${renderTemplateString(fields.cta_label, vars)}:
${ctaUrl}
${textNote}${afterCta?.text ?? ''}
---
このメールに心当たりがない場合は、無視してください。
  `.trim()

  return { subject, html, text }
}

/**
 * React Email テンプレート（承認依頼・滞留リマインド等）向けの「文面だけ」の束。
 * HTML の枠はコンポーネント側が持ち、ここは差し込み済みの文字列を渡すだけ。
 * 文字列は React が描画時にエスケープするので dangerouslySetInnerHTML は使わないこと。
 */
export interface EmailCopy {
  subject: string
  heading: string
  /** 段落ごとの文字列（段落内の単独改行は '\n' のまま。描画側で <br /> にする） */
  bodyParagraphs: string[]
  ctaLabel: string
  /** 空なら出さない */
  note: string
}

export function buildEmailCopy(fields: TemplateFields, vars: TemplateVars): EmailCopy {
  const r = (s: string) => renderTemplateString(s, vars)
  return {
    subject: r(fields.subject).replace(/[\r\n]+/g, ' '),
    heading: r(fields.heading),
    bodyParagraphs: fields.body
      .split(/\n[ \t]*\n/)
      .map((p) => r(p.trim()))
      .filter(Boolean),
    ctaLabel: r(fields.cta_label),
    note: r(fields.note.trim()),
  }
}
