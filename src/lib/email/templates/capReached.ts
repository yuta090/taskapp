/**
 * 上限到達のお知らせ（事務所の owner/admin 宛・2通）の文面。
 *  - free_cap_upgrade: 共通LINEの無料通知枠に達した → Pro 導線（営業文面。価格が動くので編集可能にする価値が高い）
 *  - pool_ai_exhausted: プールAI（当社鍵）の月次上限に達した → 自社AIキー登録の導線
 * 枠は core.renderSimpleEmail（固定スロット無し）。⚠ 相手先には送らない事務所向けの文面。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import { renderSimpleEmail, type PlaceholderDef, type RenderedEmail, type TemplateFields, type TemplateVars } from './core'

export const CAP_TEMPLATE_KEYS = ['free_cap_upgrade', 'pool_ai_exhausted'] as const
export type CapTemplateKey = (typeof CAP_TEMPLATE_KEYS)[number]

export interface CapTemplateVars {
  orgName: string
  /** 無料枠の上限（通）。プールAIでは使わない */
  limitLabel: string
  /** 上限がリセットされる日（例: 2026年10月1日） */
  resetDateLabel: string
  appName: string
}

const ORG: PlaceholderDef & { varKey: keyof CapTemplateVars } = { name: '組織名', varKey: 'orgName', description: '上限に達した事務所の名前', sample: '株式会社サンプル' }
const RESET: PlaceholderDef & { varKey: keyof CapTemplateVars } = { name: 'リセット日', varKey: 'resetDateLabel', description: '上限が戻る日（翌月1日）', sample: '2026年10月1日' }
const APP: PlaceholderDef & { varKey: keyof CapTemplateVars } = { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' }
const LIMIT: PlaceholderDef & { varKey: keyof CapTemplateVars } = { name: '上限数', varKey: 'limitLabel', description: '今月の無料通知枠（通）', sample: '50' }

export const CAP_PLACEHOLDERS: Record<CapTemplateKey, ReadonlyArray<PlaceholderDef & { varKey: keyof CapTemplateVars }>> = {
  free_cap_upgrade: [ORG, LIMIT, RESET, APP],
  pool_ai_exhausted: [ORG, RESET, APP],
}

export function capVarsByName(key: CapTemplateKey, vars: CapTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of CAP_PLACEHOLDERS[key]) out[p.name] = vars[p.varKey]
  return out
}

export const CAP_TEMPLATE_DEFAULTS: Record<CapTemplateKey, TemplateFields> = {
  free_cap_upgrade: {
    subject: '【{{サービス名}}】今月の無料通知枠に達しました（Proで送信枠拡大・即時通知）',
    heading: '今月の無料通知枠（{{上限数}}通）に達しました',
    body: [
      '{{組織名}} の共通LINE自動通知が、今月の上限（{{上限数}}通）に達しました。以降の自動通知は{{リセット日}}まで停止します。',
      '（相手先とのやり取りへの個別返信は引き続きご利用いただけます。）',
      '',
      'Proにアップグレードすると：',
      '・送信枠の拡大（上限で止まらない）',
      '・即時通知（日次まとめを待たない）',
      '・自社LINE（事務所名で相手先に届く・白ラベル）',
    ].join('\n'),
    cta_label: 'プランを確認する',
    note: '',
  },
  pool_ai_exhausted: {
    subject: '【{{サービス名}}】プールAIの今月の上限に達しました（自社AIキー登録で即時復旧）',
    heading: 'プールAIの今月の上限に達しました',
    body: [
      '{{組織名}} で共有提供しているAI（当社のAIキー）が、今月の利用上限に達しました。',
      'そのため、チャットからの自動タスク抽出が一時的に停止しています。',
      '',
      '自社のAIキーを登録すると、その場で復旧します（上限の影響を受けなくなります）。',
      '登録は設定画面から数分で完了します。',
    ].join('\n'),
    cta_label: 'AIキーを登録する',
    note: '※ 登録しない場合も、{{リセット日}}には自動的に上限がリセットされ再開します。',
  },
}

export const CAP_TEMPLATE_META: Record<CapTemplateKey, { label: string; description: string; accent: string }> = {
  free_cap_upgrade: {
    label: '無料通知枠に達したお知らせ',
    description: '共通LINEの無料通知枠（月次）に達したとき、事務所の管理者に届く Pro 案内のメール',
    accent: '#4f46e5',
  },
  pool_ai_exhausted: {
    label: 'プールAIの上限に達したお知らせ',
    description: '当社提供のAI枠（月次）に達したとき、事務所の管理者に届く自社AIキー登録案内のメール',
    accent: '#4f46e5',
  },
}

/** 翌月1日のラベル（JST の日付成分で計算する。now は jstNow() を渡すこと） */
export function nextMonthResetLabel(nowJst: Date): string {
  const d = new Date(nowJst.getFullYear(), nowJst.getMonth() + 1, 1)
  return `${d.getFullYear()}年${d.getMonth() + 1}月1日`
}

export function renderCapReachedEmail(input: {
  key: CapTemplateKey
  fields: TemplateFields
  vars: CapTemplateVars
  ctaUrl: string
}): RenderedEmail {
  return renderSimpleEmail({
    appName: input.vars.appName,
    accent: CAP_TEMPLATE_META[input.key].accent,
    fields: input.fields,
    vars: capVarsByName(input.key, input.vars),
    ctaUrl: input.ctaUrl,
  })
}
