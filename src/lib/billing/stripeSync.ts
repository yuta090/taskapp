import type { PlanId } from './entitlements'

/**
 * Stripe サブスクリプション状態 → org_billing への写像（純粋ロジック）。
 *
 * webhook（イベント駆動）と reconcile cron（定期ポーリング）の両方がこの写像を使い、
 * 挙動を一致させる。webhook 欠落で org_billing が stale になり over-entitlement に
 * なるのを、reconcile が Stripe のライブ状態から拾い直して閉じる（真実源は Stripe）。
 */

export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled'

/**
 * Stripe の subscription.status を org_billing.status（4値CHECK）へ写像する。
 * 既知ステータスの写像は webhook と厳密に同一。未知ステータスの扱いだけ呼び出し側で
 * 選べる（webhook は 'active' を保持＝従来挙動、reconcile は 'canceled' で fail-safe）。
 */
export function mapStripeSubscriptionStatus(
  status: string,
  opts: { unknownFallback?: BillingStatus } = {},
): BillingStatus {
  switch (status) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
      return 'past_due'
    case 'canceled':
    case 'unpaid':
      return 'canceled'
    default:
      return opts.unknownFallback ?? 'active'
  }
}

export interface StripePriceMap {
  pro: string | null
  enterprise: string | null
}

/**
 * Stripe の price id を PlanId へ写像する。未知/null は undefined（plan_id を変更しない）。
 */
export function resolvePlanIdFromPriceId(
  priceId: string | null | undefined,
  priceMap: StripePriceMap,
): PlanId | undefined {
  if (!priceId) return undefined
  if (priceMap.pro && priceId === priceMap.pro) return 'pro'
  if (priceMap.enterprise && priceId === priceMap.enterprise) return 'enterprise'
  return undefined
}

/** reconcile が扱う org_billing の可変フィールド。 */
export interface BillingReconcilePatch {
  plan_id?: PlanId
  status: BillingStatus
  current_period_end: string | null
  cancel_at_period_end: boolean
}

/** buildBillingPatchFromSubscription が受け取る Stripe.Subscription の構造的サブセット。 */
export interface SubscriptionLike {
  status: string
  current_period_end?: number | null
  cancel_at_period_end?: boolean | null
  items?: { data?: Array<{ price?: { id?: string | null } | null }> } | null
  metadata?: Record<string, string> | null
}

const PLAN_IDS: ReadonlySet<string> = new Set<PlanId>(['free', 'pro', 'enterprise'])

/**
 * ライブの Stripe サブスクから org_billing への patch を組み立てる。
 * plan_id の決定順: price id 写像 → metadata.plan_id → （どちらも不明なら含めない＝既存維持）。
 * status は mapStripeSubscriptionStatus に委譲（reconcile では unknownFallback='canceled'）。
 */
export function buildBillingPatchFromSubscription(
  subscription: SubscriptionLike,
  opts: { priceMap: StripePriceMap; unknownFallback?: BillingStatus },
): BillingReconcilePatch {
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null
  let planId = resolvePlanIdFromPriceId(priceId, opts.priceMap)
  if (!planId) {
    const metaPlan = subscription.metadata?.plan_id
    if (metaPlan && PLAN_IDS.has(metaPlan)) planId = metaPlan as PlanId
  }

  const cpe = subscription.current_period_end
  const patch: BillingReconcilePatch = {
    status: mapStripeSubscriptionStatus(subscription.status, {
      unknownFallback: opts.unknownFallback,
    }),
    current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
  }
  if (planId) patch.plan_id = planId
  return patch
}

export interface BillingCurrentRow {
  plan_id: string | null
  status: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
}

/**
 * patch が現在行を実際に変えるかを判定する（変えないなら DB 書き込みを省く）。
 * plan_id は patch に含まれるときだけ比較する（含まれない＝変更しない意図）。
 */
export function billingPatchDiffers(
  current: BillingCurrentRow,
  patch: Partial<BillingReconcilePatch>,
): boolean {
  if (patch.plan_id !== undefined && patch.plan_id !== current.plan_id) return true
  if (patch.status !== undefined && patch.status !== current.status) return true
  if (
    patch.current_period_end !== undefined &&
    patch.current_period_end !== current.current_period_end
  )
    return true
  if (
    patch.cancel_at_period_end !== undefined &&
    patch.cancel_at_period_end !== (current.cancel_at_period_end ?? false)
  )
    return true
  return false
}

/**
 * Stripe 側でサブスクが消えている（resource_missing）場合の patch。
 * webhook の handleSubscriptionDeleted と同じく free/active に戻す。
 * （呼び出し側で stripe_subscription_id も null 化する）
 */
export function deletedSubscriptionPatch(): BillingReconcilePatch {
  return {
    plan_id: 'free',
    status: 'active',
    current_period_end: null,
    cancel_at_period_end: false,
  }
}
