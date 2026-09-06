import { createAdminClient } from '@/lib/supabase/admin'
import { constructWebhookEvent } from '@/lib/stripe'
import { mapStripeSubscriptionStatus, subscriptionPeriodEndUnix, stripePriceMapFromEnv, type SubscriptionLike } from '@/lib/billing/stripeSync'
import { notifyBillingLifecycle, shouldNotifyBillingTransition, type BillingSnapshot } from '@/lib/billing/billingLifecycleNotify'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

// Webhookはbodyをrawで受け取る必要がある
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      )
    }

    let event: Stripe.Event

    try {
      event = constructWebhookEvent(body, signature)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      )
    }

    // ⚠ Stripe からの呼び出しは「ログインしていない訪問者」なので cookie client（anon）では org_billing に触れない
    // （RLS: anon は権限剥奪・SELECT は authenticated のみ）。他の webhook/cron と同じく service role を使う
    const supabase = createAdminClient()

    // イベントタイプに応じた処理
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(supabase, session)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionUpdate(supabase, subscription)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(supabase, subscription)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentFailed(supabase, invoice)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

type WebhookSupabase = ReturnType<typeof createAdminClient>

/**
 * 更新前の org_billing（遷移判定用）。
 * 「行が無い」(ok, snapshot=null) と「読めなかった」(ok=false) を区別する。読めなかったときは
 * メールを送らない（fail-closed: 初回扱いにして有効化メールを誤送するより、送らない方が安全）。
 */
type SnapshotRead = { ok: true; snapshot: (BillingSnapshot & { org_id: string }) | null } | { ok: false }

async function readBillingSnapshot(supabase: WebhookSupabase, column: 'org_id' | 'stripe_subscription_id', value: string): Promise<SnapshotRead> {
  const { data, error } = await (supabase as SupabaseClient)
    .from('org_billing')
    .select('org_id, status, plan_id')
    .eq(column, value)
    .maybeSingle()
  if (error) {
    console.error('readBillingSnapshot failed', column, error)
    return { ok: false }
  }
  return { ok: true, snapshot: (data as (BillingSnapshot & { org_id: string }) | null) ?? null }
}

/**
 * 課金の出来事メール（有料開始・支払い失敗・解約）。状態が実際に遷移したときだけ送る。
 * 送信失敗は webhook を失敗させない（Stripe のリトライで DB 更新が二重に走るのを避ける）。
 */
async function notifyIfTransitioned(input: {
  event: Parameters<typeof shouldNotifyBillingTransition>[0]
  orgId: string
  before: BillingSnapshot | null
  after: BillingSnapshot
}) {
  const key = shouldNotifyBillingTransition(input.event, input.before, input.after)
  if (!key) return
  try {
    await notifyBillingLifecycle({ orgId: input.orgId, key, planId: input.after.plan_id })
  } catch (err) {
    console.error('billing lifecycle notify failed', input.orgId, key, err)
  }
}

// Checkout完了時の処理
async function handleCheckoutCompleted(
  supabase: WebhookSupabase,
  session: Stripe.Checkout.Session
) {
  const orgId = session.metadata?.org_id
  const planId = session.metadata?.plan_id

  if (!orgId || !planId) {
    console.error('Missing metadata in checkout session')
    return
  }

  const read = await readBillingSnapshot(supabase, 'org_id', orgId)

  // org_billingを更新
  const { error } = await (supabase as SupabaseClient)
    .from('org_billing')
    .upsert({
      org_id: orgId,
      plan_id: planId,
      status: 'active',
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      updated_at: new Date().toISOString(),
    })
  if (error) {
    // 更新できていないのに「有効になりました」と伝えない
    console.error('handleCheckoutCompleted: org_billing upsert failed', orgId, error)
    return
  }
  if (!read.ok) return

  await notifyIfTransitioned({ event: 'checkout_completed', orgId, before: read.snapshot, after: { status: 'active', plan_id: planId } })
}

// サブスクリプション更新時の処理
async function handleSubscriptionUpdate(
  supabase: WebhookSupabase,
  subscription: Stripe.Subscription
) {
  const orgId = subscription.metadata?.org_id
  const planId = subscription.metadata?.plan_id

  if (!orgId) {
    console.error('Missing org_id in subscription metadata')
    return
  }

  // ステータスをマッピング（reconcile cron と同一の共有写像を使う。
  // 未知ステータスの既定は 'active'＝従来 webhook 挙動を保持）
  const status = mapStripeSubscriptionStatus(subscription.status)

  // current_period_end を安全に取得（Clover 以降は item 側にあるため共有ヘルパで解決）。
  // 枠追加アドオンで item が複数になるため priceMap を渡し、**プランの item 側**を優先する
  // （渡さないとアドオンの期間で上書きされ得る）。
  const currentPeriodEnd = subscriptionPeriodEndUnix(
    subscription as unknown as SubscriptionLike,
    stripePriceMapFromEnv(),
  )
  const cancelAtPeriodEnd = (subscription as unknown as { cancel_at_period_end?: boolean }).cancel_at_period_end

  const read = await readBillingSnapshot(supabase, 'org_id', orgId)

  const { error } = await (supabase as SupabaseClient)
    .from('org_billing')
    .update({
      plan_id: planId || undefined,
      status,
      current_period_end: currentPeriodEnd
        ? new Date(currentPeriodEnd * 1000).toISOString()
        : null,
      cancel_at_period_end: cancelAtPeriodEnd ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
  if (error) {
    console.error('handleSubscriptionUpdate: org_billing update failed', orgId, error)
    return
  }
  if (!read.ok) return

  await notifyIfTransitioned({
    event: 'subscription_updated',
    orgId,
    before: read.snapshot,
    // plan_id が metadata に無ければ変わらない（前の値を引き継ぐ）
    after: { status, plan_id: planId || read.snapshot?.plan_id || null },
  })
}

// サブスクリプション削除時の処理
async function handleSubscriptionDeleted(
  supabase: WebhookSupabase,
  subscription: Stripe.Subscription
) {
  const orgId = subscription.metadata?.org_id

  if (!orgId) {
    console.error('Missing org_id in subscription metadata')
    return
  }

  const read = await readBillingSnapshot(supabase, 'org_id', orgId)

  // Freeプランに戻す
  const { error } = await (supabase as SupabaseClient)
    .from('org_billing')
    .update({
      plan_id: 'free',
      status: 'active',
      stripe_subscription_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
  if (error) {
    console.error('handleSubscriptionDeleted: org_billing update failed', orgId, error)
    return
  }
  if (!read.ok) return

  // 解約メールには「解約したプラン名」を載せたいので planId は前のプラン
  const before = read.snapshot
  const key = shouldNotifyBillingTransition('subscription_deleted', before, { status: 'active', plan_id: 'free' })
  if (key) {
    try {
      await notifyBillingLifecycle({ orgId, key, planId: before?.plan_id ?? null })
    } catch (err) {
      console.error('billing lifecycle notify failed', orgId, key, err)
    }
  }
}

// 支払い失敗時の処理
async function handlePaymentFailed(
  supabase: WebhookSupabase,
  invoice: Stripe.Invoice
) {
  // subscription を安全に取得
  const subscriptionId = (invoice as unknown as { subscription?: string }).subscription

  if (!subscriptionId) {
    return
  }

  // サブスクリプションIDから組織を特定してステータス更新。
  // 「まだ past_due でない行だけ」を1文で更新し、返った行＝自分が遷移させた行にだけメールを送る
  // （読み→書きの間に同じ通知が並走しても二重送信にならない）
  const { data: changed, error } = await (supabase as SupabaseClient)
    .from('org_billing')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)
    .neq('status', 'past_due')
    .select('org_id, plan_id')
  if (error) {
    console.error('handlePaymentFailed: org_billing update failed', subscriptionId, error)
    return
  }
  const rows = (changed as Array<{ org_id: string; plan_id: string | null }> | null) ?? []
  if (rows.length > 1) {
    // stripe_subscription_id に一意制約が無い。複数 org に同じ id が付いているのは異常なので目に見える形で残す
    console.error('handlePaymentFailed: multiple org_billing rows share one subscription id', subscriptionId, rows.map((r) => r.org_id))
  }
  for (const row of rows) {
    await notifyIfTransitioned({
      event: 'payment_failed',
      orgId: row.org_id,
      before: { status: 'active', plan_id: row.plan_id },
      after: { status: 'past_due', plan_id: row.plan_id },
    })
  }
}
