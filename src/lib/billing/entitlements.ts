import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Entitlement layer (phase 1).
 *
 * Source of truth is `org_billing.plan_id`. Feature availability per plan is
 * kept as a code-level map (PLAN_FEATURES) — no feature columns/tables are
 * added to the DB. This module only resolves "what plan/features does this
 * org have" — it does NOT gate any feature yet (that's a later phase).
 */

export type PlanId = 'free' | 'pro' | 'enterprise'
export type Feature =
  | 'line_pickup_dual_mode' // 会話からの自動タスク拾い（dual mode）
  | 'timed_line_reminders' // 時刻リマインド
  | 'own_line_account' // 自社名義Bot(白ラベル)の登録・共有→専用への移行開始
  | 'line_direct_dm' // 担当者への1:1個別DM配信（共有botは構造的に不可）
  | 'instant_line_notify' // 即時通知（Freeは日次digest統合のみ）

const PLAN_IDS: ReadonlySet<string> = new Set<PlanId>(['free', 'pro', 'enterprise'])

// Pro/Enterprise の中核価値（白ラベル・1:1DM・即時・時刻リマインド）を pro 以上に集約する。
// 事業判断(2026-07): 自動タスク拾い(line_pickup_dual_mode)は Free にも開放し入口として機能させる。
//   ただし差別化として Free は日次digestまとめのみ・即時通知(instant_line_notify)は Pro 専有とする
//   （＝「拾い」ではなく「即時性」で課金差をつける）。
export const PLAN_FEATURES: Record<PlanId, ReadonlySet<Feature>> = {
  free: new Set(['line_pickup_dual_mode']),
  pro: new Set([
    'line_pickup_dual_mode',
    'timed_line_reminders',
    'own_line_account',
    'line_direct_dm',
    'instant_line_notify',
  ]),
  enterprise: new Set([
    'line_pickup_dual_mode',
    'timed_line_reminders',
    'own_line_account',
    'line_direct_dm',
    'instant_line_notify',
  ]),
}

/**
 * 数量制限（プランごと）。機能フラグ(PLAN_FEATURES)とは別マップにする。
 * DBに列は足さない phase 1 方針を維持（コード内マップ）。null = 無制限。
 * monthlySharedPushQuota は共通LINE(共有bot)の送信クォータ。Stripe webhook/reconcile 内の
 * service role が org_channel_policy.monthly_push_quota へ同期する（コンソール直書きは禁止）。
 *
 * NOTE(要決定・数値): 下記は仮の初期値。実運用の集計（有料org数・平均グループ数・push実績）を見て
 *   確定する。Free は「狭く始めて広げる」（増やすのは無風・減らすのは炎上）ため小さめに置く。
 *
 * ⚠ 重要(fable指摘・要フォローアップ): LINE無料枠(200通/月)は「LINEアカウント単位・共有bot全org相乗り」で
 *   あり org 単位ではない。よって monthlySharedPushQuota を「org別cap」だけで運用すると、1 Free org が
 *   共有アカウントの無料枠を食い潰し持ち出しが非有界になる。正しくは【グローバル予算(200×アカウント数＋
 *   許容持ち出し) ＋ org別cap(日次digest 1通/日から逆算した実効 ~35-60通/月)】の二層制にする。
 *   下の org別cap は日次digest設計に沿った安全側の値に下げ、グローバル予算の実装は別PR。
 */
export interface PlanLimits {
  /** 接続できる相手先グループ数の上限。null=無制限 */
  maxLineGroups: number | null
  /** 共通LINE(共有bot)の org別 月間送信クォータ（日次digest基準の安全側仮値）。null=無制限 */
  monthlySharedPushQuota: number | null
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { maxLineGroups: 3, monthlySharedPushQuota: 50 },
  pro: { maxLineGroups: 50, monthlySharedPushQuota: null },
  enterprise: { maxLineGroups: null, monthlySharedPushQuota: null },
}

export function planLimits(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan]
}

export interface OrgBillingRow {
  plan_id: string | null
  status: string | null
  current_period_end: string | null // ISO or null
  cancel_at_period_end: boolean | null
}

const PAST_DUE_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000

function isPlanId(value: string | null | undefined): value is PlanId {
  return typeof value === 'string' && PLAN_IDS.has(value)
}

/**
 * Pure function. Given an org_billing row (or null) and the current time,
 * returns the effective plan. Fail-closed: any unrecognized/ambiguous state
 * resolves to 'free'.
 */
export function resolvePlanFromBilling(row: OrgBillingRow | null, now: Date): PlanId {
  if (!row) return 'free'
  if (!isPlanId(row.plan_id)) return 'free'

  const plan = row.plan_id

  if (row.status === 'active' || row.status === 'trialing') {
    // cancel_at_period_end=true still keeps the plan active until the period actually ends.
    return plan
  }

  if (row.status === 'past_due') {
    if (!row.current_period_end) return 'free'
    const periodEndMs = new Date(row.current_period_end).getTime()
    if (Number.isNaN(periodEndMs)) return 'free'
    const graceDeadlineMs = periodEndMs + PAST_DUE_GRACE_PERIOD_MS
    return now.getTime() <= graceDeadlineMs ? plan : 'free'
  }

  // canceled / unpaid / incomplete_expired / unknown -> free
  return 'free'
}

export function planHasFeature(plan: PlanId, feature: Feature): boolean {
  return PLAN_FEATURES[plan].has(feature)
}

/**
 * Resolves an org's plan + feature access using a service-role client.
 * Always resolves (never throws) — DB errors fail-closed to 'free'.
 */
export async function resolveOrgEntitlements(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date()
): Promise<{ planId: PlanId; has: (f: Feature) => boolean }> {
  let planId: PlanId = 'free'

  try {
    const { data, error } = await admin
      .from('org_billing')
      .select('plan_id,status,current_period_end,cancel_at_period_end')
      .eq('org_id', orgId)
      .maybeSingle()

    if (error) {
      planId = resolvePlanFromBilling(null, now)
    } else {
      planId = resolvePlanFromBilling((data as OrgBillingRow | null) ?? null, now)
    }
  } catch {
    // Never throw — fail-closed to free.
    planId = 'free'
  }

  return {
    planId,
    has: (f: Feature) => planHasFeature(planId, f),
  }
}
