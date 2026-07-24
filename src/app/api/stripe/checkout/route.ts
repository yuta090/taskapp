import { createClient } from '@/lib/supabase/server'
import { getStripe, PLANS, PlanId } from '@/lib/stripe'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // 認証チェック
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { org_id, plan_id } = body

    // バリデーション
    if (!org_id || !plan_id) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Enterprise はセルフサーブ購入不可＝営業主導(sales-led)契約の受け皿。
    // 課金モデル裁定(2026-07-24・Fable): checkout に出さず「お問い合わせ」へ誘導する。
    // priceId が env に設定済みでも、ここで拒否する（自動購入を構造的に塞ぐ）。
    if (plan_id === 'enterprise') {
      return NextResponse.json(
        {
          error: 'Enterprise は営業窓口での個別契約です。お問い合わせください。',
          code: 'enterprise_contact_sales',
        },
        { status: 400 }
      )
    }

    // プランの存在確認
    const plan = PLANS[plan_id as PlanId]
    if (!plan || !plan.priceId) {
      return NextResponse.json(
        { error: 'Invalid plan or plan not configured' },
        { status: 400 }
      )
    }

    // ユーザーが組織のownerであることを確認
    const { data: membership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', org_id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only organization owners can manage billing' },
        { status: 403 }
      )
    }

    // 組織の現在の課金情報を取得
    const { data: billing } = await (supabase as SupabaseClient)
      .from('org_billing')
      .select('stripe_customer_id')
      .eq('org_id', org_id)
      .single()

    const stripe = getStripe()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Checkoutセッション作成
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: billing?.stripe_customer_id || undefined,
      customer_email: billing?.stripe_customer_id ? undefined : user.email,
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/settings/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/settings/billing?canceled=true`,
      metadata: {
        org_id,
        plan_id,
        user_id: user.id,
      },
      subscription_data: {
        metadata: {
          org_id,
          plan_id,
        },
      },
    })

    return NextResponse.json({
      session_id: session.id,
      url: session.url,
    })
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
