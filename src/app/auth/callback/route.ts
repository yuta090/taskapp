import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { resolvePostLoginLanding } from '@/lib/auth/resolveLanding'
import { ACTIVE_ORG_COOKIE } from '@/lib/org/constants'

/** LoginClient の isSafeInternalPath と同じ検証（オープンリダイレクト防止） */
function isSafeInternalPath(path: string | null): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
}

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

  // next パラメータ付き（招待のログインリンク等）は行き先が明示されているのでそちらへ復帰。
  // LoginClient の redirect パラメータと同じ優先順位・バリデーション。
  if (isSafeInternalPath(next)) {
    return NextResponse.redirect(new URL(next, origin))
  }

  // 着地判定（org_memberships → role別のvendor/space判定）は LoginClient と共通のロジックに委譲
  try {
    const preferredOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? null
    const landing = await resolvePostLoginLanding(supabase, user.id, { preferredOrgId })
    return NextResponse.redirect(new URL(landing, origin))
  } catch (err) {
    // membershipクエリエラー等 → fail closed（ログインページへ）
    console.error('resolvePostLoginLanding failed:', err)
    return NextResponse.redirect(
      new URL('/login?error=auth_callback_failed', origin)
    )
  }
}
