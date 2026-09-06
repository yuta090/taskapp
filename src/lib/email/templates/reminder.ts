/**
 * 相手先への滞留リマインド（日次・受信者ごと1通）の文面。
 * 期限超過あり／なしで件名の既定が違うので2キー。HTML の枠は ReminderEmail.tsx（React Email）で、
 * 「○○ 様」の行・タスク一覧（期限超過／本日期限／滞留の3節）・配信停止の案内はコード固定のスロット。
 * ※ client bundle からも import されるので server 専用モジュールをここに入れないこと。
 */
import type { PlaceholderDef, TemplateFields, TemplateVars } from './core'

export const REMINDER_TEMPLATE_KEYS = ['reminder_client', 'reminder_client_overdue'] as const
export type ReminderTemplateKey = (typeof REMINDER_TEMPLATE_KEYS)[number]

export interface ReminderTemplateVars {
  /** 受信者の表示名。無ければ '' */
  displayName: string
  totalCount: number
  overdueCount: number
  dueTodayCount: number
  appName: string
}

export const REMINDER_PLACEHOLDERS: ReadonlyArray<PlaceholderDef & { varKey: keyof ReminderTemplateVars }> = [
  { name: '宛名', varKey: 'displayName', description: '受信者の表示名（無ければ空）', sample: 'クライアント太郎' },
  { name: '件数', varKey: 'totalCount', description: 'ご対応待ちタスクの合計件数', sample: '2' },
  { name: '期限超過件数', varKey: 'overdueCount', description: '期限を過ぎたタスクの件数', sample: '1' },
  { name: '本日期限件数', varKey: 'dueTodayCount', description: '本日が期限のタスクの件数', sample: '1' },
  { name: 'サービス名', varKey: 'appName', description: 'このサービスの名前', sample: 'AgentPM' },
]

export function reminderVarsByName(vars: ReminderTemplateVars): TemplateVars {
  const out: TemplateVars = {}
  for (const p of REMINDER_PLACEHOLDERS) out[p.name] = String(vars[p.varKey])
  return out
}

const COMMON = {
  heading: 'ご対応待ちのタスクが{{件数}}件あります',
  body: '以下のタスクについて、ご対応をお待ちしています。',
  cta_label: 'タスクを確認',
  note: '',
}

export const REMINDER_TEMPLATE_DEFAULTS: Record<ReminderTemplateKey, TemplateFields> = {
  reminder_client: {
    subject: '【{{サービス名}}】ご対応待ちのタスクが{{件数}}件あります',
    ...COMMON,
  },
  reminder_client_overdue: {
    subject: '【{{サービス名}}】ご対応待ちのタスクが{{件数}}件あります（期限超過{{期限超過件数}}件）',
    ...COMMON,
  },
}

export const REMINDER_TEMPLATE_META: Record<ReminderTemplateKey, { label: string; description: string; accent: string }> = {
  reminder_client: {
    label: '滞留リマインド（期限超過なし）',
    description: '相手先に、止まっているタスクをまとめて知らせる日次メール。タスク一覧と配信停止の案内はコード固定',
    accent: '#f59e0b',
  },
  reminder_client_overdue: {
    label: '滞留リマインド（期限超過あり）',
    description: '期限を過ぎたタスクが1件以上あるときに使う文面（件名で件数を強調）',
    accent: '#f59e0b',
  },
}

export function reminderKeyFor(overdueCount: number): ReminderTemplateKey {
  return overdueCount > 0 ? 'reminder_client_overdue' : 'reminder_client'
}
