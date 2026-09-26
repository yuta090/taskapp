/**
 * 運営画面 /admin/change-log（データの変更の控え change_log を探す画面）の、
 * 絞り込みの読み取りと表示の言葉。change_log は DB トリガーが主要な表の変更を全部記録する表
 * （migration 20260926091821_change_log.sql）。
 */

export const CHANGE_LOG_PAGE_LIMIT = 100

export type ChangeLogOp = 'I' | 'U' | 'D'

export interface ChangeLogFilters {
  table?: string
  rowId?: string
  actorId?: string
  orgId?: string
  channel?: string
  op?: ChangeLogOp
  from?: string
  to?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABLE_RE = /^[a-z_]{1,63}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const CHANNEL_LABELS: Record<string, string> = {
  app: '画面',
  cli: 'CLI',
  mcp: '外部チャット(MCP)',
  stdio: 'ローカルMCP',
  portal: 'ポータル',
  cron: '定期処理',
  webhook: '外部からの受信',
  connector: '連携',
  admin: '運営画面',
  system: 'システム',
  unattributed: '不明（サーバー）',
}

const OP_LABELS: Record<ChangeLogOp, string> = { I: '追加', U: '更新', D: '削除' }

const ACTOR_KIND_LABELS: Record<string, string> = {
  user: '本人',
  api_key: 'APIキー',
  service: 'サーバー',
  system: 'システム',
}

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v === undefined || v === '' ? undefined : v
}

/** URL の ?… から絞り込みを読む。形のおかしい値は捨てる（そのまま問い合わせに使わない） */
export function parseChangeLogFilters(params: SearchParams): ChangeLogFilters {
  const out: ChangeLogFilters = {}

  const table = first(params.table)
  if (table && TABLE_RE.test(table)) out.table = table

  const row = first(params.row)
  if (row && UUID_RE.test(row)) out.rowId = row

  const actor = first(params.actor)
  if (actor && UUID_RE.test(actor)) out.actorId = actor

  const org = first(params.org)
  if (org && UUID_RE.test(org)) out.orgId = org

  const channel = first(params.channel)
  if (channel && channel in CHANNEL_LABELS) out.channel = channel

  const op = first(params.op)
  if (op === 'I' || op === 'U' || op === 'D') out.op = op

  // 日付は日本時間のその日の始まり・終わりにする（toISOString は使わない）
  const from = first(params.from)
  if (from && DATE_RE.test(from)) out.from = `${from}T00:00:00+09:00`

  const to = first(params.to)
  if (to && DATE_RE.test(to)) out.to = `${to}T23:59:59.999+09:00`

  return out
}

export function opLabel(op: ChangeLogOp): string {
  return OP_LABELS[op]
}

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel
}

export function channelOptions(): Array<{ value: string; label: string }> {
  return Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))
}

export function actorKindLabel(kind: string): string {
  return ACTOR_KIND_LABELS[kind] ?? kind
}

/** 行の ID を1つの文字列にする。id があればそれ、複合キーは値を / でつなぐ */
export function rowIdOf(rowPk: Record<string, unknown> | null): string {
  if (!rowPk) return '-'
  if (typeof rowPk.id === 'string' || typeof rowPk.id === 'number') return String(rowPk.id)
  return Object.values(rowPk).map(String).join(' / ')
}
