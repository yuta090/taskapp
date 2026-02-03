import { createClient } from '@/lib/supabase/server'
import { constructWebhookEvent } from '@/lib/stripe'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

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

  // org_billingを更新
  await (supabase as any)
    .from('org_billing')
    .upsert({
      org_id: orgId,
      plan_id: planId,
      status: 'active',
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      updated_at: new Date().toISOString(),
    })
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

  // ステータスをマッピング
  let status: string
  switch (subscription.status) {
    case 'active':
      status = 'active'
      break
    case 'trialing':
      status = 'trialing'
      break
    case 'past_due':
      status = 'past_due'
      break
    case 'canceled':
    case 'unpaid':
      status = 'canceled'
      break
    default:
      status = 'active'
  }

  // current_period_endを安全に取得
  const currentPeriodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end
  const cancelAtPeriodEnd = (subscription as unknown as { cancel_at_period_end?: boolean }).cancel_at_period_end

  await (supabase as any)
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

  // Freeプランに戻す
  await (supabase as any)
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

  // サブスクリプションIDから組織を特定してステータス更新
  await (supabase as any)
    .from('org_billing')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)
}
