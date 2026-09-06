/**
 * 課金の出来事（有料開始・支払い失敗・解約）を事務所の owner/admin にメールで知らせる（server 専用）。
 *
 * Stripe webhook は同じ通知を繰り返す・順序が入れ替わることがあるので、呼び出し側は
 * 「更新前の org_billing の状態」を読み、`shouldNotifyBillingTransition` が true のときだけ送る。
 * メール送信の失敗は webhook を失敗させない（ログのみ）。
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBillingLifecycleEmail } from '@/lib/email/billingLifecycle'
import type { BillingTemplateKey } from '@/lib/email/templates/billingLifecycle'
import { loadEmailTemplate } from '@/lib/email/templates/loadEmailTemplate'
import { PLAN_LABELS } from './featureCatalog'
import type { PlanId } from './entitlements'

export interface BillingSnapshot {
  status: string | null
  plan_id: string | null
}

export type BillingTransitionEvent = 'checkout_completed' | 'subscription_updated' | 'subscription_deleted' | 'payment_failed'

/**
 * 更新前後の状態から「どのメールを送るか」を決める（純関数）。null = 送らない。
 * - 有料開始: 有料プランで active になった。ただし前も同じ有料プランで active なら送らない（重複通知）
 * - 支払い失敗: past_due になった。前も past_due なら送らない
 * - 解約: 有料プランから free に戻った。前が free なら送らない
 */
export function shouldNotifyBillingTransition(
  event: BillingTransitionEvent,
  before: BillingSnapshot | null,
  after: BillingSnapshot,
): BillingTemplateKey | null {
  const beforeStatus = before?.status ?? null
  const beforePlan = before?.plan_id ?? null
  const afterPaid = !!after.plan_id && after.plan_id !== 'free'

  if (event === 'payment_failed' || (event === 'subscription_updated' && after.status === 'past_due')) {
    if (after.status !== 'past_due') return null
    return beforeStatus === 'past_due' ? null : 'billing_payment_failed'
  }
  if (event === 'subscription_deleted') {
    return beforePlan && beforePlan !== 'free' ? 'billing_canceled' : null
  }
  if (after.status === 'active' && afterPaid) {
    const alreadyActiveSamePlan = beforeStatus === 'active' && beforePlan === after.plan_id
    return alreadyActiveSamePlan ? null : 'billing_activated'
  }
  return null
}

export function planLabelOf(planId: string | null | undefined): string {
  if (!planId) return ''
  return (PLAN_LABELS as Record<string, string>)[planId as PlanId] ?? planId
}

/**
 * 事務所の owner/admin 全員へ送る。宛先が解決できない／送れない場合もログだけで例外にしない。
 * 戻り値は送信を試みた件数（テスト・ログ用）。
 */
export async function notifyBillingLifecycle(input: {
  orgId: string
  key: BillingTemplateKey
  planId: string | null
}): Promise<number> {
  const client = createAdminClient()
  let orgName = '貴社'
  let recipients: string[] = []
  try {
    const [{ data: org }, { data: admins }] = await Promise.all([
      client.from('organizations').select('name').eq('id', input.orgId).maybeSingle(),
      client.from('org_memberships').select('user_id').eq('org_id', input.orgId).in('role', ['owner', 'admin']),
    ])
    orgName = (org as { name?: string } | null)?.name ?? orgName
    recipients = ((admins as Array<{ user_id: string }> | null) ?? []).map((m) => m.user_id)
  } catch (err) {
    console.error('notifyBillingLifecycle: resolve org/recipients failed', input.orgId, err)
    return 0
  }
  if (recipients.length === 0) return 0

  const planLabel = planLabelOf(input.planId)
  // 文面は宛先の人数分ではなく1回だけ読む
  const fields = await loadEmailTemplate(input.key)
  let sent = 0
  await Promise.all(
    recipients.map(async (userId) => {
      try {
        const { data } = await client.auth.admin.getUserById(userId)
        const email = data.user?.email
        if (!email) return
        await sendBillingLifecycleEmail({ to: email, key: input.key, orgName, planLabel, fields })
        sent += 1
      } catch (err) {
        console.error('notifyBillingLifecycle: email send failed', userId, err)
      }
    }),
  )
  return sent
}
