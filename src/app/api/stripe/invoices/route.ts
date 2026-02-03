import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
import { getStripeServerConfigStatus } from '@/lib/stripe/config'
import { NextRequest, NextResponse } from 'next/server'

export interface InvoiceItem {
  id: string
  number: string | null
  amount_due: number
  amount_paid: number
  currency: string
  status: string | null
  created: number
  invoice_pdf: string | null
  hosted_invoice_url: string | null
}

export async function GET(request: NextRequest) {
  try {
    // Stripe設定チェック
    const stripeStatus = getStripeServerConfigStatus()
    if (!stripeStatus.isConfigured) {
      return NextResponse.json({ invoices: [] })
    }

    const supabase = await createClient()

    // 認証チェック
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // org_id取得
    const { searchParams } = new URL(request.url)
    let orgId: string | null = searchParams.get('org_id')

    // org_idが指定されていない場合、ユーザーのプライマリ組織を取得
    if (!orgId) {
      const { data: primaryMembership, error: primaryError } = await (supabase as any)
        .from('org_memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (primaryError && primaryError.code !== 'PGRST116') {
        console.error('Primary org lookup error:', primaryError)
        return NextResponse.json(
          { error: 'Failed to determine organization' },
          { status: 500 }
        )
      }

      if (!primaryMembership) {
        return NextResponse.json({ invoices: [] })
      }
      orgId = primaryMembership.org_id as string
    }

    // UUID形式チェック
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!orgId || !uuidRegex.test(orgId)) {
      return NextResponse.json(
        { error: 'Invalid org_id format' },
        { status: 400 }
      )
    }

    // ユーザーが組織のオーナーであることを確認（請求情報はオーナーのみ閲覧可能）
    const { data: membership, error: membershipError } = await (supabase as any)
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .single()

    if (membershipError) {
      console.error('Membership check error:', membershipError)
      return NextResponse.json(
        { error: 'Failed to verify organization membership' },
        { status: 500 }
      )
    }

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this organization' },
        { status: 403 }
      )
    }

    // 請求情報はオーナーのみアクセス可能
    if (membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only organization owners can view billing information' },
        { status: 403 }
      )
    }

    // 組織のstripe_customer_idを取得
    const { data: billing } = await (supabase as any)
      .from('org_billing')
      .select('stripe_customer_id')
      .eq('org_id', orgId)
      .single()

    if (!billing?.stripe_customer_id) {
      return NextResponse.json({ invoices: [] })
    }

    const stripe = getStripe()

    // Stripeから請求書一覧を取得
    const stripeInvoices = await stripe.invoices.list({
      customer: billing.stripe_customer_id,
      limit: 24, // 過去2年分程度
    })

    // 必要なフィールドのみ返却
    const invoices: InvoiceItem[] = stripeInvoices.data.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      amount_due: invoice.amount_due,
      amount_paid: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status,
      created: invoice.created,
      invoice_pdf: invoice.invoice_pdf ?? null,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    }))

    return NextResponse.json({ invoices })
  } catch (err) {
    console.error('Invoices fetch error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch invoices' },
      { status: 500 }
    )
  }
}
