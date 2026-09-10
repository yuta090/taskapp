import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
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
    const { org_id } = body

    if (!org_id) {
      return NextResponse.json(
        { error: 'Missing org_id' },
        { status: 400 }
      )
    }

    // UUID形式チェック
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(org_id)) {
      return NextResponse.json(
        { error: 'Invalid org_id format' },
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

    // 組織の課金情報を取得
    const { data: billing } = await (supabase as SupabaseClient)
      .from('org_billing')
      .select('stripe_customer_id')
      .eq('org_id', org_id)
      .single()

    if (!billing?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No billing information found' },
        { status: 404 }
      )
    }

    const stripe = getStripe()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    /*
      カスタマーポータル。支払い方法の変更・請求書・解約のための窓口で、
      オンライン申し込みを閉じている間も既存のお客様には開けておく。

      ⚠ ただし Stripe の既定のポータル設定では「プランの変更」まで許可されていることがあり、
      そこから申し込みの元栓（STRIPE_SELF_SERVE_ENABLED）を迂回できてしまう。
      `STRIPE_PORTAL_CONFIGURATION_ID` に「プラン変更を無効にしたポータル設定」を指定すると、
      支払い方法・請求書・解約だけを許す形に固定できる（Stripe ダッシュボードで作成する）。
      未指定なら Stripe 側の既定設定が使われる。
    */
    const portalConfigurationId = process.env.STRIPE_PORTAL_CONFIGURATION_ID
    const session = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${appUrl}/settings/billing`,
      ...(portalConfigurationId ? { configuration: portalConfigurationId } : {}),
    })

    return NextResponse.json({
      url: session.url,
    })
  } catch (err) {
    console.error('Portal error:', err)
    return NextResponse.json(
      { error: 'Failed to create portal session' },
      { status: 500 }
    )
  }
}
