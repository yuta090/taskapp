import { createClient } from '@/lib/supabase/server'
import { constructWebhookEvent } from '@/lib/stripe'
import { mapStripeSubscriptionStatus, subscriptionPeriodEndUnix, stripePriceMapFromEnv, type SubscriptionLike } from '@/lib/billing/stripeSync'
import { notifyBillingLifecycle, shouldNotifyBillingTransition, type BillingSnapshot } from '@/lib/billing/billingLifecycleNotify'
import { formatJstDateLabel } from '@/lib/email/templates/billingLifecycle'
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

    const supabase = await createClient()

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

type WebhookSupabase = ReturnType<typeof createClient> extends Promise<infer T> ? T : never

/** 更新前の org_billing（遷移判定用）。読めなければ null = 「前の状態は不明」として扱う */
async function readBillingSnapshot(supabase: WebhookSupabase, column: 'org_id' | 'stripe_subscription_id', value: string): Promise<BillingSnapshot | null> {
  try {
    const { data } = await (supabase as SupabaseClient)
      .from('org_billing')
      .select('org_id, status, plan_id')
      .eq(column, value)
      .maybeSingle()
    return (data as (BillingSnapshot & { org_id?: string }) | null) ?? null
  } catch (err) {
    console.error('readBillingSnapshot failed', err)
    return null
  }
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
  nextBillingDateLabel?: string
}) {
  const key = shouldNotifyBillingTransition(input.event, input.before, input.after)
  if (!key) return
  try {
    await notifyBillingLifecycle({ orgId: input.orgId, key, planId: input.after.plan_id, nextBillingDateLabel: input.nextBillingDateLabel })
  } catch (err) {
    console.error('billing lifecycle notify failed', input.orgId, key, err)
  }
}

// Checkout完了時の処理
async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  session: Stripe.Checkout.Session
) {
  const orgId = session.metadata?.org_id
  const planId = session.metadata?.plan_id

  if (!orgId || !planId) {
    console.error('Missing metadata in checkout session')
    return
  }

  const before = await readBillingSnapshot(supabase, 'org_id', orgId)

  // org_billingを更新
  await (supabase as SupabaseClient)
    .from('org_billing')
    .upsert({
      org_id: orgId,
      plan_id: planId,
      status: 'active',
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      updated_at: new Date().toISOString(),
    })

  await notifyIfTransitioned({ event: 'checkout_completed', orgId, before, after: { status: 'active', plan_id: planId } })
}

// サブスクリプション更新時の処理
async function handleSubscriptionUpdate(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
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

  const before = await readBillingSnapshot(supabase, 'org_id', orgId)

  await (supabase as SupabaseClient)
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

  await notifyIfTransitioned({
    event: 'subscription_updated',
    orgId,
    before,
    // plan_id が metadata に無ければ変わらない（前の値を引き継ぐ）
    after: { status, plan_id: planId || before?.plan_id || null },
    nextBillingDateLabel: formatJstDateLabel(currentPeriodEnd),
  })
}

// サブスクリプション削除時の処理
async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  subscription: Stripe.Subscription
) {
  const orgId = subscription.metadata?.org_id

  if (!orgId) {
    console.error('Missing org_id in subscription metadata')
    return
  }

  const before = await readBillingSnapshot(supabase, 'org_id', orgId)

  // Freeプランに戻す
  await (supabase as SupabaseClient)
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

  // 解約メールには「解約したプラン名」を載せたいので after.plan_id は前のプラン、状態は free に戻った扱い
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
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  invoice: Stripe.Invoice
) {
  // subscription を安全に取得
  const subscriptionId = (invoice as unknown as { subscription?: string }).subscription

  if (!subscriptionId) {
    return
  }

  const before = await readBillingSnapshot(supabase, 'stripe_subscription_id', subscriptionId)

  // サブスクリプションIDから組織を特定してステータス更新
  await (supabase as SupabaseClient)
    .from('org_billing')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)

  const orgId = (before as (BillingSnapshot & { org_id?: string }) | null)?.org_id
  if (orgId) {
    await notifyIfTransitioned({ event: 'payment_failed', orgId, before, after: { status: 'past_due', plan_id: before?.plan_id ?? null } })
  }
}
