/**
 * ウェルカムメールのテンプレート（組織作成完了直後・最初の使い方案内）。
 *
 * 件名・見出し・本文・ボタン・補足は運営が管理画面で編集できる（既定 = WELCOME_TEMPLATE_DEFAULTS）。
 * 「最初の3ステップ + LINE秘書連携」の手順表と、ヘルプへの案内はコード固定のスロット。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { escapeHtml } from '../escape'
import { renderSimpleEmail, type PlaceholderDef, type RenderedEmail, type TemplateFields, type TemplateVars } from './core'

export const WELCOME_TEMPLATE_KEY = 'welcome' as const

/** 差し込みに使える値（呼び出し側のプログラム用の名前） */
export interface WelcomeTemplateVars {
  orgName: string
  appName: string
}

/** 文面に書ける差し込み語（運営向けの日本語名 ↔ プログラム用の名前）。足したら varKey も必ず足す */
export const WELCOME_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof WelcomeTemplateVars }> = [
  { name: '組織名', varKey: 'orgName', description: '登録した組織（事務所）の名前', sample: '株式会社サンプル' },
  { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' },
]

function welcomeVarsByName(vars: WelcomeTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of WELCOME_PLACEHOLDERS) out[p.name] = vars[p.varKey]
  return out
}

export const WELCOME_TEMPLATE_DEFAULTS: TemplateFields = {
  subject: '【{{サービス名}}】ようこそ！最初の3ステップ + LINE秘書連携',
  heading: 'ようこそ、{{組織名}} 様',
  body: '{{サービス名}} へのご登録ありがとうございます。まずは以下の3ステップから始めましょう。',
  cta_label: '{{サービス名}} にログイン',
  note: '',
}

export const WELCOME_TEMPLATE_META = {
  label: 'ようこそメール',
  description: '組織を作成した直後に、最初の使い方を案内するメール（手順表とヘルプ案内はコード固定）',
  accent: '#f59e0b',
} as const

/** 最初の3ステップ + LINE秘書連携（コード固定・製品の手順なので運営が言い換えない） */
const STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: '① 最初のタスクを作成', detail: 'タイトルを入力してEnterを押すだけで作成できます。' },
  { title: '② メンバー・クライアントを招待', detail: '「設定」→「メンバー」から招待できます。' },
  { title: '③ タスクをクライアントに公開', detail: 'タスクを「クライアントに公開」すると、ポータルで共有できます。' },
  {
    title: '④ LINE秘書と連携',
    detail: '秘書コンソールのQRで友だち追加し、表示されたコードをトークに送信すると連携完了です（追加だけでは連携されません）。',
  },
]

export interface WelcomeEmailContentParams {
  orgName: string
  appName: string
  appUrl: string
  /** 管理画面で保存された文面。無ければ既定 */
  fields?: TemplateFields
}

export type WelcomeEmailContent = RenderedEmail

export function buildWelcomeEmailContent(params: WelcomeEmailContentParams): WelcomeEmailContent {
  const { appName, appUrl, orgName } = params
  const fields = params.fields ?? WELCOME_TEMPLATE_DEFAULTS
  const loginUrl = `${appUrl}/login`
  const helpUrl = `${appUrl}/help`

  const stepsHtml = `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0;">${STEPS.map(
                (s, i) => `
                <tr>
                  <td style="padding: 12px 0;${i < STEPS.length - 1 ? ' border-bottom: 1px solid #e5e7eb;' : ''}">
                    <p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${escapeHtml(s.title)}</p>
                    <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">${escapeHtml(s.detail)}</p>
                  </td>
                </tr>`,
              ).join('')}
              </table>`
  const stepsText = `\n${STEPS.map((s) => `${s.title}\n${s.detail}`).join('\n\n')}\n`

  return renderSimpleEmail({
    appName,
    accent: WELCOME_TEMPLATE_META.accent,
    fields,
    vars: welcomeVarsByName({ orgName, appName }),
    ctaUrl: loginUrl,
    beforeCta: { html: stepsHtml, text: stepsText },
    afterCta: {
      html: `
              <p style="margin: 32px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                使い方でわからないことがあれば、<a href="${escapeHtml(helpUrl)}" style="color: ${WELCOME_TEMPLATE_META.accent};">ヘルプページ</a>をご覧ください。
              </p>`,
      text: `\n使い方でわからないことがあれば、ヘルプページをご覧ください:\n${helpUrl}\n`,
    },
  })
}
