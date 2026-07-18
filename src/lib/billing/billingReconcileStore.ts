/**
 * Stripe reconcile（webhook 欠落の是正）のデータアクセス層（service role 専用）。
 * org_billing の「Stripe サブスク紐付きかつ非free」な行を洗い出し、ライブ状態から更新する。
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillingReconcilePatch } from './stripeSync'

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

export interface ReconcilableBillingRow {
  orgId: string
  planId: string | null
  status: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean | null
  stripeSubscriptionId: string
}

/**
 * reconcile 対象の org_billing 行を返す。
 * 対象は「Stripe サブスク紐付きあり かつ plan_id が free でない」行のみ
 * （free 行は over-entitlement の余地が無いので Stripe を叩かない＝API 呼び出しを節約）。
 */
type Row = {
  org_id: string
  plan_id: string | null
  status: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  stripe_subscription_id: string | null
}

/** Supabase の1レスポンス上限。これを超える対象を1ページで取り切れないため keyset で回す。 */
const RECONCILE_PAGE_SIZE = 1000

export async function listReconcilableBillingRows(): Promise<ReconcilableBillingRow[]> {
  const out: ReconcilableBillingRow[] = []
  let lastOrgId: string | null = null

  // keyset ページング（org_id 昇順）。offset だと途中で行が変わるとズレるため gt(org_id) で辿る。
  // org_id は org_billing の一意キー前提。全ページを取り切るまで回す。
  for (;;) {
    let query = admin()
      .from('org_billing')
      .select('org_id, plan_id, status, current_period_end, cancel_at_period_end, stripe_subscription_id')
      .not('stripe_subscription_id', 'is', null)
      .neq('plan_id', 'free')
      .order('org_id', { ascending: true })
      .limit(RECONCILE_PAGE_SIZE)
    if (lastOrgId) query = query.gt('org_id', lastOrgId)

    const { data, error } = await query
    // エラーを空扱いにすると「DB障害＝対象なし」と誤認して静かに何もしない。必ず throw。
    if (error) throw new Error(`listReconcilableBillingRows failed: ${error.message}`)

    const batch = (data as Row[] | null) ?? []
    for (const r of batch) {
      if (!r.stripe_subscription_id) continue
      out.push({
        orgId: r.org_id,
        planId: r.plan_id,
        status: r.status,
        currentPeriodEnd: r.current_period_end,
        cancelAtPeriodEnd: r.cancel_at_period_end,
        stripeSubscriptionId: r.stripe_subscription_id,
      })
    }
    if (batch.length < RECONCILE_PAGE_SIZE) break
    lastOrgId = batch[batch.length - 1].org_id
  }

  return out
}

/**
 * reconcile で確定した patch を org_billing に反映する。
 * clearSubscriptionId=true（Stripe側で消滅）のときは stripe_subscription_id も null 化する。
 *
 * expectedSubscriptionId を渡すと、更新条件に stripe_subscription_id を含める（compare-and-swap）。
 * reconcile は「行を sub A で読んだ」前提で patch を作るため、取得〜書込の隙間に webhook/checkout が
 * sub を B に差し替えていた場合、org_id だけを条件にすると A の状態を B に誤適用しうる。
 * sub を条件に含めれば、その場合は 0 行更新＝良性の no-op になる（次回 cron が B を拾い直す）。
 */
export async function applyBillingReconcile(
  orgId: string,
  patch: BillingReconcilePatch,
  opts: { clearSubscriptionId?: boolean; expectedSubscriptionId?: string } = {},
): Promise<void> {
  const update: Record<string, unknown> = {
    status: patch.status,
    current_period_end: patch.current_period_end,
    cancel_at_period_end: patch.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }
  if (patch.plan_id !== undefined) update.plan_id = patch.plan_id
  if (opts.clearSubscriptionId) update.stripe_subscription_id = null

  let query = admin().from('org_billing').update(update).eq('org_id', orgId)
  if (opts.expectedSubscriptionId) {
    query = query.eq('stripe_subscription_id', opts.expectedSubscriptionId)
  }
  const { error } = await query
  if (error) {
    throw new Error(`applyBillingReconcile failed for ${orgId}: ${error.message}`)
  }
}
