import type { PlanId, PlanLimits } from './entitlements'

/**
 * 枠追加の見積もり（billing_quotes）の純粋ロジック。
 *
 * 課金モデル（2026-07-26 決定）: 追加課金を認める軸は **内部メンバー** と
 * **相手先グループ（LINE/外部チャット）** の2つだけ。プロジェクト数・共通LINE送信量・
 * 相手先ユーザー数は加算対象にしない（プロジェクトは課金しない裁定・他は原価/価値の性質が違う）。
 *
 * 承認済み(approved)の行の合算が、そのまま実効上限への加算になる
 * （override テーブルは作らない＝quote行が唯一の正本）。
 */

export type BillingQuoteStatus =
  | 'requested'
  | 'offered'
  | 'approved'
  | 'rejected'
  | 'canceled'
  | 'expired'
  | 'terminated'

export type StripeSyncStatus = 'n/a' | 'pending' | 'applied' | 'manual'

export interface BillingQuoteRow {
  id: string
  org_id: string
  status: BillingQuoteStatus
  requested_by?: string | null
  requested_note?: string | null
  requested_at?: string | null
  amount_monthly_jpy: number | null
  add_members: number
  add_line_groups: number
  add_external_chat_groups: number
  offer_note?: string | null
  offered_at?: string | null
  expires_at?: string | null
  approved_at?: string | null
  stripe_sync_status?: StripeSyncStatus
}

export interface QuoteDeltas {
  addMembers: number
  addLineGroups: number
  addExternalChatGroups: number
}

export const EMPTY_QUOTE_DELTAS: QuoteDeltas = {
  addMembers: 0,
  addLineGroups: 0,
  addExternalChatGroups: 0,
}

/** 非負の整数だけを採る。負値・NaN は 0（減枠は terminated で表現する約束を守らせる）。 */
function nonNegative(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * 承認済み(approved)の見積もりだけを合算する。
 * terminated / rejected / expired / offered は数えない（終了＝加算が消える）。
 */
export function sumApprovedQuoteDeltas(rows: readonly BillingQuoteRow[]): QuoteDeltas {
  return rows.reduce<QuoteDeltas>((acc, row) => {
    if (row.status !== 'approved') return acc
    return {
      addMembers: acc.addMembers + nonNegative(row.add_members),
      addLineGroups: acc.addLineGroups + nonNegative(row.add_line_groups),
      addExternalChatGroups: acc.addExternalChatGroups + nonNegative(row.add_external_chat_groups),
    }
  }, { ...EMPTY_QUOTE_DELTAS })
}

/**
 * プランの基本上限に加算を反映する。
 *
 * - **有料(pro/enterprise)のときだけ加算**する。free に落ちたら追加枠は自動失効
 *   （解約後に枠だけ残る over-entitlement を構造的に防ぐ）。
 * - null=無制限は加算しても無制限のまま。
 * - 課金しない軸（maxProjects / monthlySharedPushQuota / maxClientUsers）は触らない。
 */
export function applyQuoteDeltasToLimits(
  base: PlanLimits,
  deltas: QuoteDeltas,
  planId: PlanId,
): PlanLimits {
  if (planId === 'free') return base

  const add = (limit: number | null, delta: number): number | null =>
    limit === null ? null : limit + nonNegative(delta)

  return {
    ...base,
    maxMembers: add(base.maxMembers, deltas.addMembers),
    maxLineGroups: add(base.maxLineGroups, deltas.addLineGroups),
    maxExternalChatGroups: add(base.maxExternalChatGroups, deltas.addExternalChatGroups),
  }
}
