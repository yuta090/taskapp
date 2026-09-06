/**
 * 管理画面で編集できるメール文面の台帳（純粋モジュール）。
 *
 * ここに載っているキーだけが email_templates に保存でき（API が台帳外キーを 400 で拒否）、
 * 管理画面はこの台帳から「カテゴリ → テンプレート」の一覧を作る。
 * 追加の手順: 純粋な描画モジュール（既定文面＋差し込み語＋render）を作り、ここに1件足すだけ。
 * 編集対象にしないメール（一覧が主役のもの・運営内部通知・検知的統制）は NON_EDITABLE_EMAILS に理由つきで載せる。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { sampleVars, type PlaceholderDef, type RenderedEmail, type TemplateFields } from './core'
import {
  INVITE_PLACEHOLDERS,
  INVITE_TEMPLATE_DEFAULTS,
  INVITE_TEMPLATE_META,
  renderInviteEmail,
  type InviteTemplateVars,
} from './invite'
import { WELCOME_PLACEHOLDERS, WELCOME_TEMPLATE_DEFAULTS, WELCOME_TEMPLATE_META, buildWelcomeEmailContent } from './welcome'
import { APPROVAL_PLACEHOLDERS_BY_KEY, APPROVAL_TEMPLATE_DEFAULTS, APPROVAL_TEMPLATE_KEYS, APPROVAL_TEMPLATE_META } from './approval'
import { REMINDER_PLACEHOLDERS, REMINDER_TEMPLATE_DEFAULTS, REMINDER_TEMPLATE_KEYS, REMINDER_TEMPLATE_META } from './reminder'
import { CAP_PLACEHOLDERS, CAP_TEMPLATE_DEFAULTS, CAP_TEMPLATE_KEYS, CAP_TEMPLATE_META, renderCapReachedEmail, type CapTemplateKey } from './capReached'

/** カテゴリ（表示順） */
export const EMAIL_TEMPLATE_FAMILIES = [
  { id: 'invite', label: '招待', description: '相手先やメンバーをプロジェクトに招待するときに届くメール' },
  { id: 'onboarding', label: 'はじめての案内', description: '登録直後に届く、最初の使い方の案内' },
  { id: 'approval', label: '相手先への承認依頼', description: 'ボールが相手先に移ったときに届く、ワンクリック承認のメール' },
  { id: 'reminder', label: '滞留リマインド', description: '相手先に、止まっているタスクをまとめて知らせるメール' },
  { id: 'billing', label: '料金・上限のお知らせ', description: '無料枠やAI上限に達したとき、事務所の管理者に届くメール' },
] as const
export type EmailTemplateFamily = (typeof EMAIL_TEMPLATE_FAMILIES)[number]['id']

export interface EmailTemplateDef {
  key: string
  family: EmailTemplateFamily
  label: string
  description: string
  /** ヘッダ・ボタンの色（メールHTML内のみ） */
  accent: string
  defaults: TemplateFields
  placeholders: ReadonlyArray<PlaceholderDef>
  /**
   * 管理画面のプレビュー: 見本の値で描く（純粋・ブラウザで実行）。
   * 無いテンプレート（React Email 製）は server 側 `renderEmailPreview`（POST /api/admin/email-templates/preview）で描く。
   */
  renderPreview?: (fields: TemplateFields, appName: string) => RenderedEmail
}

const PREVIEW_APP_URL = 'https://agentpm.app'

function inviteSample(appName: string): InviteTemplateVars {
  const s = sampleVars(INVITE_PLACEHOLDERS)
  return {
    inviterName: s['招待者名'],
    orgName: s['組織名'],
    spaceName: s['プロジェクト名'],
    expiresDate: s['有効期限'],
    appName,
  }
}

const PREVIEW_MESSAGE = '（招待するときに添える一言があれば、ここに引用として入ります）'

export const EMAIL_TEMPLATE_DEFS: ReadonlyArray<EmailTemplateDef> = [
  {
    key: 'invite_client',
    family: 'invite',
    ...INVITE_TEMPLATE_META.invite_client,
    defaults: INVITE_TEMPLATE_DEFAULTS.invite_client,
    placeholders: INVITE_PLACEHOLDERS,
    renderPreview: (fields, appName) =>
      renderInviteEmail({
        variant: 'client',
        fields,
        vars: inviteSample(appName),
        inviteUrl: `${PREVIEW_APP_URL}/portal/xxxxxxxx`,
        message: PREVIEW_MESSAGE,
      }),
  },
  {
    key: 'invite_member',
    family: 'invite',
    ...INVITE_TEMPLATE_META.invite_member,
    defaults: INVITE_TEMPLATE_DEFAULTS.invite_member,
    placeholders: INVITE_PLACEHOLDERS,
    renderPreview: (fields, appName) =>
      renderInviteEmail({
        variant: 'member',
        fields,
        vars: inviteSample(appName),
        inviteUrl: `${PREVIEW_APP_URL}/invite/xxxxxxxx`,
        message: PREVIEW_MESSAGE,
      }),
  },
  {
    key: 'welcome',
    family: 'onboarding',
    ...WELCOME_TEMPLATE_META,
    defaults: WELCOME_TEMPLATE_DEFAULTS,
    placeholders: WELCOME_PLACEHOLDERS,
    renderPreview: (fields, appName) =>
      buildWelcomeEmailContent({
        orgName: sampleVars(WELCOME_PLACEHOLDERS)['組織名'],
        appName,
        appUrl: PREVIEW_APP_URL,
        fields,
      }),
  },
  ...APPROVAL_TEMPLATE_KEYS.map((key) => ({
    key,
    family: 'approval' as const,
    ...APPROVAL_TEMPLATE_META[key],
    defaults: APPROVAL_TEMPLATE_DEFAULTS[key],
    placeholders: APPROVAL_PLACEHOLDERS_BY_KEY[key],
  })),
  ...REMINDER_TEMPLATE_KEYS.map((key) => ({
    key,
    family: 'reminder' as const,
    ...REMINDER_TEMPLATE_META[key],
    defaults: REMINDER_TEMPLATE_DEFAULTS[key],
    placeholders: REMINDER_PLACEHOLDERS,
  })),
  ...CAP_TEMPLATE_KEYS.map((key: CapTemplateKey) => ({
    key,
    family: 'billing' as const,
    ...CAP_TEMPLATE_META[key],
    defaults: CAP_TEMPLATE_DEFAULTS[key],
    placeholders: CAP_PLACEHOLDERS[key],
    renderPreview: (fields: TemplateFields, appName: string) =>
      renderCapReachedEmail({
        key,
        fields,
        vars: { orgName: '株式会社サンプル', limitLabel: '50', resetDateLabel: '2026年10月1日', appName },
        ctaUrl: key === 'free_cap_upgrade' ? `${PREVIEW_APP_URL}/settings/billing` : `${PREVIEW_APP_URL}/settings/org-integrations`,
      }),
  })),
]

export const EMAIL_TEMPLATE_KEYS: ReadonlyArray<string> = EMAIL_TEMPLATE_DEFS.map((d) => d.key)

const DEF_BY_KEY = new Map(EMAIL_TEMPLATE_DEFS.map((d) => [d.key, d]))

export function isEmailTemplateKey(v: unknown): v is string {
  return typeof v === 'string' && DEF_BY_KEY.has(v)
}

export function getEmailTemplateDef(key: string): EmailTemplateDef | undefined {
  return DEF_BY_KEY.get(key)
}

/**
 * ここでは編集しないメール（管理画面の説明用）。
 * 判定基準（Fable 裁定 2026-09-07）: 外向き × 文章が主役 × 文面が売れ行き/開封に効く、を満たさないもの。
 */
export const NON_EDITABLE_EMAILS: ReadonlyArray<{ label: string; reason: string }> = [
  { label: '日次まとめ（事務所メンバー向け）', reason: '更新の一覧が主役で、文面を変える価値が薄いため' },
  { label: '共有botグループ紐付けのお知らせ', reason: '不正な紐付けに気づかせるための通知で、正確さが命のため' },
  { label: '共通LINE開通申込・リード獲得（運営向け）', reason: '運営自身が受け取る内部通知のため' },
  { label: 'TASK6 資料ダウンロード', reason: 'メディア側のコンテンツ運用で扱うため' },
  { label: 'サインアップ確認・パスワード再設定', reason: 'Supabase（認証基盤）のダッシュボードで編集するため' },
]
