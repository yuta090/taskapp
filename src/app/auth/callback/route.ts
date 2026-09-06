import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { resolvePostLoginLanding } from '@/lib/auth/resolveLanding'
import { recordAuthFailure } from '@/lib/auth/authEventLog'
import { buildLoginErrorPath, classifyProviderCallbackError } from '@/lib/auth/authErrorMessage'
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

  // Supabase/Google から error 付きで戻ってきた。
  // ユーザーの取り消し(access_denied)だけがキャンセル。それ以外は設定不備（合鍵違い・戻り先未登録等）の
  // 可能性が高いので理由コードを残し、管理画面から追えるようにする。
  if (errorParam) {
    const errorCode = searchParams.get('error_code')
    const errorDescription = searchParams.get('error_description')
    await recordAuthFailure({
      stage: 'provider_callback',
      provider: 'google',
      errorCode: errorCode ?? errorParam,
      errorDescription,
      request,
      metadata: { error: errorParam, error_code: errorCode, next },
    })
    return NextResponse.redirect(
      new URL(buildLoginErrorPath(classifyProviderCallbackError({ error: errorParam, errorCode })), origin)
    )
  }

  if (!code) {
    await recordAuthFailure({ stage: 'missing_code', request, metadata: { next } })
    return NextResponse.redirect(
      new URL(buildLoginErrorPath({ loginError: 'auth_callback_failed', reason: 'missing_code' }), origin)
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
    await recordAuthFailure({
      stage: 'code_exchange',
      errorCode: (error as { code?: string }).code ?? null,
      errorDescription: error.message,
      request,
      metadata: { status: (error as { status?: number }).status ?? null, next },
    })
    return NextResponse.redirect(
      new URL(buildLoginErrorPath({ loginError: 'auth_callback_failed', reason: 'exchange_failed' }), origin)
    )
  }

  // セッション取得
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    await recordAuthFailure({ stage: 'session_user', request, metadata: { next } })
    return NextResponse.redirect(
      new URL(buildLoginErrorPath({ loginError: 'auth_callback_failed', reason: 'no_user' }), origin)
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
    await recordAuthFailure({
      stage: 'landing',
      userId: user.id,
      email: user.email ?? null,
      errorDescription: err instanceof Error ? err.message : String(err),
      request,
      metadata: { next },
    })
    return NextResponse.redirect(
      new URL(buildLoginErrorPath({ loginError: 'auth_callback_failed', reason: 'landing_failed' }), origin)
    )
  }
}
