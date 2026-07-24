/**
 * TASK6 テンプレ配布（リードマグネット）のカタログ。
 *
 * 配布物は Supabase Storage の非公開バケット `task6-templates` に置き、
 * メール登録と引き換えに署名URL（期限付き）で配る。
 * ファイル本体は管理者が Supabase ダッシュボードから storagePath へアップロードする。
 *
 * key は URL(/task6/dl/[key]) と DB(template_leads.template_key,
 * check制約 ^[a-z0-9-]{1,64}$) の両方に使うため英小文字・数字・ハイフンのみ。
 */

export interface LeadMagnet {
  key: string
  /** 配布物の名前（ページ見出し・メール件名に使う） */
  title: string
  /** ページ・メールに載せる説明文 */
  description: string
  /** task6-templates バケット内のオブジェクトパス */
  storagePath: string
  /** ダウンロード時のファイル名 */
  fileName: string
  /** 申込ページに載せる「中身の紹介」箇条書き */
  bullets: string[]
}

/** 署名URLの有効期限（秒）。メール記載のリンクはこの時間で失効する */
export const SIGNED_URL_TTL_SECONDS = 72 * 60 * 60
export const SIGNED_URL_TTL_HOURS = 72

export const TEMPLATES_BUCKET = 'task6-templates'

export const LEAD_MAGNETS: Record<string, LeadMagnet> = {
  'task-list-excel': {
    key: 'task-list-excel',
    title: 'タスク管理表 Excelテンプレート',
    description:
      'そのまま使えるタスク管理表のExcelテンプレートです。担当・期限・状態のほかに「いま誰が持っているか（ボール）」の列があり、待ち状態のタスクが埋もれません。',
    storagePath: 'task-list-excel/task6-task-list.xlsx',
    fileName: 'TASK6_タスク管理表テンプレート.xlsx',
    bullets: [
      '担当・期限・状態に加えて「ボール（いま誰の番か）」列つき',
      '優先度と今週やることが一目で分かる並び',
      '使い方メモのシート付き（初めてでも迷わない）',
    ],
  },
}

export function getLeadMagnet(key: string): LeadMagnet | null {
  return LEAD_MAGNETS[key] ?? null
}
