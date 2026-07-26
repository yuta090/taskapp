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
    // 未払い/一時停止系は「支払いが成立していない＝有料機能を持たせない」を
    // webhook・reconcile 双方で fail-closed に統一する（過去は default 落ちで
    // webhook のみ 'active' に倒れ over-entitlement の余地があった）。
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
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
 * env から priceMap を組み立てる共有ヘルパ。
 * webhook と reconcile が別々に組み立てると片方だけ古くなるため1点に寄せる。
 * 未設定は null（Stripe未設定環境でも落ちない）。
 */
export function stripePriceMapFromEnv(
  env: Record<string, string | undefined> = process.env,
): StripePriceMap {
  return {
    pro: env.STRIPE_PRO_PRICE_ID || null,
    enterprise: env.STRIPE_ENTERPRISE_PRICE_ID || null,
  }
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
  // 注: apiVersion '2026-01-28.clover' 以降、current_period_end は subscription 直下から
  // subscription item 側へ移った。互換のため両方を許容し、item 側を優先して読む。
  status: string
  current_period_end?: number | null
  cancel_at_period_end?: boolean | null
  items?: { data?: Array<{ price?: { id?: string | null } | null; current_period_end?: number | null }> } | null
  metadata?: Record<string, string> | null
}

/**
 * サブスクの item のうち、priceMap に載っている（＝プランを表す）ものを探す。
 *
 * 枠追加(quote承認)のアドオンが乗ると item が2つ以上になり、**先頭がアドオンになり得る**。
 * アドオンの price は priceMap に載らない＝「未知price は無視」が正しい挙動なので、
 * 全item を走査して最初に一致した item を「プランの item」とみなす。
 */
function findPlanItem(
  subscription: SubscriptionLike,
  priceMap: StripePriceMap,
): { price?: { id?: string | null } | null; current_period_end?: number | null } | undefined {
  const items = subscription.items?.data
  if (!items?.length) return undefined
  return items.find((item) => resolvePlanIdFromPriceId(item?.price?.id, priceMap) !== undefined)
}

/**
 * サブスクの現在の課金期間終了(unix秒)を取得する。Clover 以降は item 側にあるため、
 * item → 直下 の順で解決する。どこにも無ければ null。
 * webhook・reconcile 双方がこれを使い、past_due の猶予判定が null で潰れないようにする。
 *
 * priceMap を渡した場合は **プランの item を優先**する（アドオンの期間で上書きしない）。
 * 渡さない場合は従来どおり先頭 item を見る（後方互換・挙動不変）。
 */
export function subscriptionPeriodEndUnix(
  subscription: SubscriptionLike,
  priceMap?: StripePriceMap,
): number | null {
  const planItem = priceMap ? findPlanItem(subscription, priceMap) : undefined
  return (
    planItem?.current_period_end ??
    subscription.items?.data?.[0]?.current_period_end ??
    subscription.current_period_end ??
    null
  )
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
  // 枠追加アドオンで item が複数になっても壊れないよう、全item から plan price を探す
  // （先頭決め打ちだと、先頭がアドオンのとき plan_id が patch から落ちる）。
  const planItem = findPlanItem(subscription, opts.priceMap)
  let planId = resolvePlanIdFromPriceId(planItem?.price?.id, opts.priceMap)
  if (!planId) {
    const metaPlan = subscription.metadata?.plan_id
    if (metaPlan && PLAN_IDS.has(metaPlan)) planId = metaPlan as PlanId
  }

  const cpe = subscriptionPeriodEndUnix(subscription, opts.priceMap)
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
