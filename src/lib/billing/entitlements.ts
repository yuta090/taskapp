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
// NOTE(要決定・パッケージング): line_pickup_dual_mode（自動タスク拾い）を Free に開放するかは
//   事業判断（fable 提案は「Freeに入れるが即時通知は Pro のみ」）。現状は従来どおり free 無しのまま
//   据え置き、決定後に free へ 'line_pickup_dual_mode' を足す（instant_line_notify は Pro 専有を維持）。
export const PLAN_FEATURES: Record<PlanId, ReadonlySet<Feature>> = {
  free: new Set(),
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
 */
export interface PlanLimits {
  /** 接続できる相手先グループ数の上限。null=無制限 */
  maxLineGroups: number | null
  /** 共通LINE(共有bot)の月間送信クォータ。null=無制限（自社LINEは原価が顧客側のため無制限） */
  monthlySharedPushQuota: number | null
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { maxLineGroups: 3, monthlySharedPushQuota: 200 },
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
