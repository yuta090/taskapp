/**
 * 課金ライフサイクルのメール（事務所の owner/admin 宛・3通）。
 *  - billing_activated: 有料プランが有効になった（checkout 完了／未払いからの復帰）
 *  - billing_payment_failed: 支払いに失敗した（Stripe が past_due にした）
 *  - billing_canceled: 解約が確定し Free に戻った
 * 「お金・契約の出来事」はメールしか確実に届く経路が無いので、この3通だけは新設する（Fable 裁定 2026-09-07）。
 * 送るのは状態が実際に遷移したときだけ（Stripe webhook は同じ通知を繰り返すため、送信側で冪等にする）。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { renderSimpleEmail, type PlaceholderDef, type RenderedEmail, type TemplateFields, type TemplateVars } from './core'

export const BILLING_TEMPLATE_KEYS = ['billing_activated', 'billing_payment_failed', 'billing_canceled'] as const
export type BillingTemplateKey = (typeof BILLING_TEMPLATE_KEYS)[number]

export interface BillingTemplateVars {
  orgName: string
  /** 表示用のプラン名（Pro など） */
  planLabel: string
  appName: string
}

export const BILLING_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof BillingTemplateVars }> = [
  { name: '組織名', varKey: 'orgName', description: '契約している事務所の名前', sample: '株式会社サンプル' },
  { name: 'プラン名', varKey: 'planLabel', description: '対象のプラン（Pro など）', sample: 'Pro' },
  { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' },
]

export function billingVarsByName(vars: BillingTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of BILLING_PLACEHOLDERS) out[p.name] = vars[p.varKey]
  return out
}

export const BILLING_TEMPLATE_DEFAULTS: Record<BillingTemplateKey, TemplateFields> = {
  billing_activated: {
    subject: '【{{サービス名}}】{{プラン名}} プランが有効になりました',
    heading: '{{プラン名}} プランが有効になりました',
    body: [
      '{{組織名}} の {{サービス名}} は、本日より {{プラン名}} プランでご利用いただけます。',
      '自社LINE・即時通知・送信枠の拡大などがすぐに使えます。',
      '',
      'ご請求内容やお支払い方法は、いつでも「設定 → 料金プラン」から確認・変更できます。',
    ].join('\n'),
    cta_label: '料金プランを確認する',
    note: '',
  },
  billing_payment_failed: {
    subject: '【{{サービス名}}】お支払いが確認できませんでした（{{プラン名}} プラン）',
    heading: 'お支払いが確認できませんでした',
    body: [
      '{{組織名}} の {{プラン名}} プランのお支払いが完了していません。',
      'カードの有効期限切れや残高不足などが原因の場合があります。',
      '',
      '下のボタンからお支払い方法を更新してください。更新が確認できると、そのままご利用を継続できます。',
      'しばらく更新がない場合、有料機能が停止することがあります。',
    ].join('\n'),
    cta_label: 'お支払い方法を更新する',
    note: 'すでに更新済みの場合は、このメールは無視してください。お支払い方法の変更は組織オーナーのみ行えます。',
  },
  billing_canceled: {
    subject: '【{{サービス名}}】{{プラン名}} プランの解約が完了しました',
    heading: 'プランの解約が完了しました',
    body: [
      '{{組織名}} の {{プラン名}} プランは解約され、Free プランに戻りました。',
      'これまでのデータはそのまま残ります。自社LINE・即時通知などの有料機能は停止します。',
      '',
      'またいつでも「設定 → 料金プラン」から再開できます。ご利用ありがとうございました。',
    ].join('\n'),
    cta_label: '料金プランを確認する',
    note: '',
  },
}

export const BILLING_TEMPLATE_META: Record<BillingTemplateKey, { label: string; description: string; accent: string }> = {
  billing_activated: { label: '有料プランの開始', description: 'お支払いが完了し、有料プランが使えるようになったときに事務所の管理者へ届くメール', accent: '#4f46e5' },
  billing_payment_failed: { label: '支払い失敗のお知らせ', description: 'カード決済が失敗し、契約が「未払い」になったときに届くメール（最優先で届けたい1通）', accent: '#4f46e5' },
  billing_canceled: { label: '解約完了のお知らせ', description: '解約が確定して Free プランに戻ったときに届くメール', accent: '#4f46e5' },
}

export function renderBillingLifecycleEmail(input: { key: BillingTemplateKey; fields: TemplateFields; vars: BillingTemplateVars; ctaUrl: string }): RenderedEmail {
  return renderSimpleEmail({
    appName: input.vars.appName,
    accent: BILLING_TEMPLATE_META[input.key].accent,
    fields: input.fields,
    vars: billingVarsByName(input.vars),
    ctaUrl: input.ctaUrl,
  })
}
