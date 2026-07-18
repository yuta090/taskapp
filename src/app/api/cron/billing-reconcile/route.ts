import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import {
  listReconcilableBillingRows,
  applyBillingReconcile,
} from '@/lib/billing/billingReconcileStore'
import {
  buildBillingPatchFromSubscription,
  billingPatchDiffers,
  deletedSubscriptionPatch,
  type StripePriceMap,
  type SubscriptionLike,
} from '@/lib/billing/stripeSync'

export const runtime = 'nodejs'

/**
 * POST /api/cron/billing-reconcile
 *
 * pg_cron が毎時 app_invoke_billing_reconcile() 経由で呼ぶ内部API。
 * webhook 欠落で stale になった org_billing を、Stripe のライブ状態から拾い直す
 * over-entitlement 対策の backstop（真実源は Stripe）。
 *
 * fail-safe 設計:
 *   - 対象は「サブスク紐付きあり かつ非free」の行のみ（free は over-entitlement の余地なし）
 *   - 各行ごとに Stripe から subscription を取得し、共有写像で patch 化して差分があれば更新
 *   - Stripe 側で消滅（resource_missing）→ free/active に戻す（webhook deleted と同じ）
 *   - それ以外のエラー（一時障害等）→ その行はスキップして書き込まない
 *     （＝一時障害で誤って downgrade しない。次回 cron で再試行）
 *   - 未知ステータスは canceled 側へ倒す（unknownFallback='canceled'）
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他 cron と同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[billing-reconcile] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const dryRun = url.searchParams.get('dryRun') === 'true' || body.dryRun === true

  const priceMap: StripePriceMap = {
    pro: process.env.STRIPE_PRO_PRICE_ID || null,
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || null,
  }

  let stripe: ReturnType<typeof getStripe>
  try {
    stripe = getStripe()
  } catch {
    // Stripe 未設定環境（rebuild 直後など）では静かに no-op（cron を落とさない）
    return NextResponse.json({ configured: false, checked: 0, updated: 0, skipped: [] })
  }

  const rows = await listReconcilableBillingRows()

  const skipped: Array<{ orgId: string; reason: string }> = []
  const changes: Array<{ orgId: string; from: string | null; toStatus: string; toPlan?: string }> = []
  // resource_missing（削除済み）の行は即適用せず集約し、後段のサーキットブレーカ判定後にまとめて処理。
  const missingRows: typeof rows = []
  let updated = 0

  for (const row of rows) {
    try {
      const subscription = (await stripe.subscriptions.retrieve(
        row.stripeSubscriptionId,
      )) as unknown as SubscriptionLike

      const patch = buildBillingPatchFromSubscription(subscription, {
        priceMap,
        unknownFallback: 'canceled',
      })

      if (
        !billingPatchDiffers(
          {
            plan_id: row.planId,
            status: row.status,
            current_period_end: row.currentPeriodEnd,
            cancel_at_period_end: row.cancelAtPeriodEnd,
          },
          patch,
        )
      ) {
        continue // 差分なし＝書き込み不要
      }

      changes.push({
        orgId: row.orgId,
        from: row.status,
        toStatus: patch.status,
        ...(patch.plan_id ? { toPlan: patch.plan_id } : {}),
      })
      if (!dryRun) {
        await applyBillingReconcile(row.orgId, patch, {
          expectedSubscriptionId: row.stripeSubscriptionId,
        })
      }
      updated += 1
    } catch (err) {
      // Stripe 側で消滅(resource_missing)＝削除済みなら free に戻す破壊的操作。ただし即時には
      // 適用せず一旦集める（後段のサーキットブレーカで一括ダウングレードの暴発を止めるため）。
      // それ以外の一時障害(5xx/network)はスキップして次回再試行（誤 downgrade しない）。
      if (isResourceMissing(err)) {
        missingRows.push(row)
      } else {
        skipped.push({
          orgId: row.orgId,
          reason: err instanceof Error ? err.message : 'unknown',
        })
      }
    }
  }

  // サーキットブレーカ: resource_missing が「多数かつ高割合」なら、鍵取り違え/test↔live 不一致/
  // ID一括破損など運用事故の可能性が高い。全 org を一気に free 化する前に止めて調査させる。
  // 小規模アカウントでの正当な少数消滅は通す（絶対数の下限で誤発火を防ぐ）。
  const missingCount = missingRows.length
  const breakerTripped =
    missingCount >= MISSING_BREAKER_MIN_ABS && missingCount > rows.length * MISSING_BREAKER_FRACTION

  if (breakerTripped) {
    for (const row of missingRows) {
      skipped.push({ orgId: row.orgId, reason: 'resource_missing_circuit_breaker' })
    }
  } else {
    for (const row of missingRows) {
      const patch = deletedSubscriptionPatch()
      changes.push({ orgId: row.orgId, from: row.status, toStatus: patch.status, toPlan: 'free' })
      if (!dryRun) {
        await applyBillingReconcile(row.orgId, patch, {
          clearSubscriptionId: true,
          expectedSubscriptionId: row.stripeSubscriptionId,
        })
      }
      updated += 1
    }
  }

  return NextResponse.json({
    checked: rows.length,
    updated,
    skipped,
    ...(breakerTripped ? { circuitBreaker: 'resource_missing', missing: missingCount } : {}),
    ...(dryRun ? { dryRun: true, changes } : {}),
  })
}

/** resource_missing 一括ダウングレードのサーキットブレーカ閾値（絶対下限と割合の両方を満たすと発火）。 */
const MISSING_BREAKER_MIN_ABS = 5
const MISSING_BREAKER_FRACTION = 0.5

/** Stripe の「サブスクが存在しない」エラー（削除済み）を判定する。 */
function isResourceMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; statusCode?: number; type?: string }
  return (
    e.code === 'resource_missing' ||
    (e.type === 'StripeInvalidRequestError' && e.statusCode === 404)
  )
}
