/**
 * 相手先への承認依頼メール（ボールが相手先に移ったときのワンクリック承認）の文面。
 * 通常のタスク確認と、見積もりの確認で2キー。HTML の枠は ApprovalEmail.tsx（React Email）で、
 * タスクカード・見積金額・期限・「ポータルで確認」リンク・有効期間の注記はコード固定のスロット。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import type { PlaceholderDef, TemplateFields, TemplateVars } from './core'

export const APPROVAL_TEMPLATE_KEYS = ['approval_task', 'approval_estimate'] as const
export type ApprovalTemplateKey = (typeof APPROVAL_TEMPLATE_KEYS)[number]

export interface ApprovalTemplateVars {
  taskTitle: string
  spaceName: string
  orgName: string
  /** 表示用の金額（例: ￥160,000）。見積りでなければ '' */
  estimatedCostLabel: string
  /** 表示用の期限（例: 2026/7/10）。無ければ '' */
  dueDateLabel: string
  appName: string
}

export const APPROVAL_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof ApprovalTemplateVars }> = [
  { name: 'タスク名', varKey: 'taskTitle', description: '確認をお願いするタスクの名前', sample: 'フロントエンド実装 - ログイン画面' },
  { name: 'プロジェクト名', varKey: 'spaceName', description: 'タスクが属するプロジェクト', sample: 'ECサイトリニューアル' },
  { name: '組織名', varKey: 'orgName', description: '依頼している事務所の名前', sample: 'クラフトテック' },
  { name: '見積金額', varKey: 'estimatedCostLabel', description: '見積もりの金額（見積り以外は空）', sample: '￥160,000' },
  { name: '期限', varKey: 'dueDateLabel', description: 'タスクの期限（無ければ空）', sample: '2026/7/10' },
  { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' },
]

/** キーごとに使える差し込み語。タスクの確認依頼には見積金額が無いので外す（本文に書くと空欄が届くため） */
export const APPROVAL_PLACEHOLDERS_BY_KEY: Record<ApprovalTemplateKey, ReadonlyArray<PlaceholderDef & { varKey: keyof ApprovalTemplateVars }>> = {
  approval_task: APPROVAL_PLACEHOLDERS.filter((p) => p.varKey !== 'estimatedCostLabel'),
  approval_estimate: APPROVAL_PLACEHOLDERS,
}

export function approvalVarsByName(vars: ApprovalTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of APPROVAL_PLACEHOLDERS) out[p.name] = vars[p.varKey]
  return out
}

export const APPROVAL_TEMPLATE_DEFAULTS: Record<ApprovalTemplateKey, TemplateFields> = {
  approval_task: {
    subject: '【{{サービス名}}】確認をお願いします — {{タスク名}}',
    heading: '確認のお願い',
    body: '「{{プロジェクト名}}」プロジェクトでタスクの確認をお待ちしています。',
    cta_label: '内容を確認する',
    note: '',
  },
  approval_estimate: {
    subject: '【{{サービス名}}】見積もりの確認をお願いします — {{タスク名}}',
    heading: '見積もりの確認',
    body: '「{{プロジェクト名}}」プロジェクトで見積もりの確認をお待ちしています。',
    cta_label: '見積もりを確認する',
    note: '',
  },
}

export const APPROVAL_TEMPLATE_META: Record<ApprovalTemplateKey, { label: string; description: string; accent: string }> = {
  approval_task: {
    label: 'タスクの確認依頼',
    description: 'ボールが相手先に移ったときに届く、ワンクリック承認のメール（タスクカード・期限・ポータルへのリンクはコード固定）',
    accent: '#f59e0b',
  },
  approval_estimate: {
    label: '見積もりの確認依頼',
    description: '見積もりの承認をお願いするときのメール（見積金額の欄はコード固定）',
    accent: '#f59e0b',
  },
}

export function approvalKeyFor(actionType: 'approve' | 'estimate_approve'): ApprovalTemplateKey {
  return actionType === 'estimate_approve' ? 'approval_estimate' : 'approval_task'
}

export function formatCurrencyJpy(amount: number): string {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
}
