import type { StripeSyncStatus } from './quotes'

/**
 * 承認済み（＝毎月請求すべき）追加枠の一覧とCSV。
 *
 * 請求は当面「金額が分かれば足りる」運用（請求書払いが中心・Stripe自動反映は未実装）なので、
 * **経理にそのまま渡せる形**で出すのが目的。金額は数値のまま出し（合計を計算できる）、
 * 日付は日本時間、Excel で開いても文字化けしないよう BOM を付ける。
 */

export interface ApprovedQuoteWithOrg {
  id: string
  orgId: string
  orgName: string
  amountMonthlyJpy: number | null
  addMembers: number
  addLineGroups: number
  addExternalChatGroups: number
  approvedAt: string | null
  stripeSyncStatus: StripeSyncStatus
}

const HEADERS = [
  '組織名',
  '組織ID',
  '月額(円)',
  'メンバー追加',
  '相手先グループ追加',
  '他チャット追加',
  '承認日時(JST)',
  '請求反映',
] as const

const SYNC_LABEL: Record<StripeSyncStatus, string> = {
  'n/a': '—',
  pending: '未反映',
  applied: '反映済み',
  manual: '請求書',
}

/** JST の "YYYY-MM-DD HH:mm"。UTCのまま出すと1日ずれて経理が混乱する。 */
function formatJst(iso: string | null): string {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** カンマ・引用符・改行を含む値をCSVとして壊れない形にする。 */
function escapeCsv(value: string | number): string {
  const s = String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildApprovedQuotesCsv(rows: readonly ApprovedQuoteWithOrg[]): string {
  const lines = [HEADERS.join(',')]
  for (const r of rows) {
    lines.push(
      [
        escapeCsv(r.orgName),
        escapeCsv(r.orgId),
        r.amountMonthlyJpy ?? 0,
        r.addMembers,
        r.addLineGroups,
        r.addExternalChatGroups,
        escapeCsv(formatJst(r.approvedAt)),
        SYNC_LABEL[r.stripeSyncStatus] ?? '—',
      ].join(','),
    )
  }
  // BOM: Excel が UTF-8 と判定できず日本語が化けるのを防ぐ
  return `﻿${lines.join('\r\n')}\r\n`
}

/** 承認済みの月額合計（毎月いくら請求すべきかの総額）。 */
export function monthlyTotalJpy(rows: readonly ApprovedQuoteWithOrg[]): number {
  return rows.reduce((sum, r) => sum + (r.amountMonthlyJpy ?? 0), 0)
}
