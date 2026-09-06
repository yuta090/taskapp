/**
 * 招待メールの文面（相手先向け / メンバー向け）。
 *
 * 文面は運営が管理画面（/admin/email-templates）で編集でき、DB(email_templates)に保存される。
 * 保存が無いときは INVITE_TEMPLATE_DEFAULTS が使われる（= 従来のハードコード文面と同一）。
 * 枠と5項目・差し込み・エスケープの仕組みは core.ts（全テンプレート共通）。
 * ここにあるのは招待固有の「既定文面・差し込み語・有効期限の固定行」だけ。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { escapeHtml } from '../escape'
import {
  renderSimpleEmail,
  type PlaceholderDef,
  type RenderedEmail,
  type TemplateFields,
  type TemplateVars,
} from './core'

export const INVITE_TEMPLATE_KEYS = ['invite_client', 'invite_member'] as const
export type InviteTemplateKey = (typeof INVITE_TEMPLATE_KEYS)[number]

/** 差し込みに使える値（呼び出し側のプログラム用の名前） */
export interface InviteTemplateVars {
  inviterName: string
  orgName: string
  spaceName: string
  expiresDate: string
  appName: string
}

/** 文面に書ける差し込み語（運営向けの日本語名 ↔ プログラム用の名前） */
export const INVITE_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof InviteTemplateVars }> = [
  { name: '招待者名', varKey: 'inviterName', description: '招待した人の名前', sample: '山田 太郎' },
  { name: '組織名', varKey: 'orgName', description: '招待した組織の名前', sample: '株式会社サンプル' },
  { name: 'プロジェクト名', varKey: 'spaceName', description: '招待先のプロジェクト名', sample: 'ホームページ制作' },
  { name: '有効期限', varKey: 'expiresDate', description: '招待リンクの有効期限', sample: '2026年9月14日' },
  { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' },
]

export function inviteVarsByName(vars: InviteTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of INVITE_PLACEHOLDERS) out[p.name] = vars[p.varKey]
  return out
}

export const INVITE_TEMPLATE_DEFAULTS: Record<InviteTemplateKey, TemplateFields> = {
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

export interface RenderInviteEmailInput {
  variant: 'client' | 'member'
  fields: TemplateFields
  vars: InviteTemplateVars
  inviteUrl: string
  /** 招待者が添えた一言（任意） */
  message?: string
}

/** 招待メールを組み立てる（件名・HTML・テキスト）。有効期限の行はコード固定 */
export function renderInviteEmail(input: RenderInviteEmailInput): RenderedEmail {
  const { variant, fields, vars, inviteUrl, message } = input
  const key: InviteTemplateKey = variant === 'client' ? 'invite_client' : 'invite_member'
  return renderSimpleEmail({
    appName: vars.appName,
    accent: INVITE_TEMPLATE_META[key].accent,
    fields,
    vars: inviteVarsByName(vars),
    ctaUrl: inviteUrl,
    message,
    afterCta: {
      html: `
              <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                この招待リンクは <strong>${escapeHtml(vars.expiresDate)}</strong> まで有効です。
              </p>`,
      text: `\nこの招待リンクは ${vars.expiresDate} まで有効です。\n`,
    },
  })
}
