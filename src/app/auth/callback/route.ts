import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const errorParam = searchParams.get('error')

  // Google認証がキャンセルされた場合
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/login?error=auth_cancelled`, origin)
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=auth_callback_failed', origin)
    )
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component からの呼び出しでは set が失敗する場合がある
          }
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      new URL('/login?error=auth_callback_failed', origin)
    )
  }

  // セッション取得
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(
      new URL('/login?error=auth_callback_failed', origin)
    )
  }

  // org_membership の確認
  const { data: membership, error: membershipError } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // membershipクエリエラー → fail closed（ログインページへ）
  if (membershipError) {
    console.error('Membership query error:', membershipError)
    return NextResponse.redirect(
      new URL('/login?error=auth_callback_failed', origin)
    )
  }

  // membership なし → onboarding（新規ユーザー）
  if (!membership) {
    return NextResponse.redirect(new URL('/onboarding', origin))
  }

  // role に基づくリダイレクト（next パラメータより優先）
  if (membership.role === 'client') {
    return NextResponse.redirect(new URL('/portal', origin))
  }

  // 内部メンバー → 最初のプロジェクトスペースへ
  const { data: space } = await supabase
    .from('spaces')
    .select('id')
    .eq('org_id', membership.org_id)
    .eq('type', 'project')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (space) {
    // next パラメータがある場合はそちらを使用（バリデーション付き）
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) {
      return NextResponse.redirect(new URL(next, origin))
    }
    return NextResponse.redirect(
      new URL(`/${membership.org_id}/project/${space.id}`, origin)
    )
  }

  // next パラメータがある場合
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) {
    return NextResponse.redirect(new URL(next, origin))
  }

  return NextResponse.redirect(new URL('/inbox', origin))
}
