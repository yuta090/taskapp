import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sendWelcomeEmail } from '@/lib/email/welcome'

/**
 * POST /api/onboarding/welcome-email
 *
 * 組織作成完了直後に、最初の使い方を案内するウェルカムメールを認証ユーザー本人へ送信する。
 * 宛先はリクエストボディから受け取らず、認証ユーザーのメールアドレスに固定する
 * (任意アドレスへの送信悪用を防ぐため)。
 *
 * 冪等性: profiles.onboarding_flags.welcome_email_sent が true ならメールは送らず
 * { skipped: true } を返す。送信成功時のみフラグを true に更新する。
 * RESEND未設定・dryRun時は送信をスキップし、いずれもフラグは更新しない。
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!user.email) {
      return NextResponse.json({ error: 'User has no email address' }, { status: 400 })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const orgName = typeof body.orgName === 'string' ? body.orgName : ''
    const dryRun = body.dryRun === true

    const { data: profile, error: profileError } = await (supabase as SupabaseClient)
      .from('profiles')
      .select('onboarding_flags')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('[welcome-email] Failed to fetch profile:', profileError)
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
    }

    const flags = (profile?.onboarding_flags as Record<string, boolean> | null) ?? {}

    // 冪等性ガード: 既に送信済みならメールは送らずスキップを返す
    if (flags.welcome_email_sent === true) {
      return NextResponse.json({ skipped: true })
    }

    const result = await sendWelcomeEmail({ to: user.email, orgName, dryRun })

    if (dryRun) {
      return NextResponse.json({ dryRun: true })
    }

    if (result.skipped) {
      return NextResponse.json({ skipped: true, reason: result.reason })
    }

    const { error: updateError } = await (supabase as SupabaseClient)
      .from('profiles')
      .update({ onboarding_flags: { ...flags, welcome_email_sent: true } })
      .eq('id', user.id)

    if (updateError) {
      console.error('[welcome-email] Failed to update onboarding flag:', updateError)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[welcome-email] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
