import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ACTIVE_ORG_COOKIE, ACTIVE_ORG_COOKIE_OPTIONS } from '@/lib/org/constants'
import { resolveActiveOrg } from '@/lib/org/resolveActiveOrg'

// 認証不要のパス
const publicPaths = [
  '/login',
  '/signup',
  '/reset',
  '/invite',
  '/api/auth',
  '/auth/callback',
  '/docs',
]

// 認証が必要なパス（portalは独自のauth checkを持つが、middleware でセッションリフレッシュ必要）
const authRequiredPrefixes = [
  '/portal',
]

// 認証が必要なパス（これ以外はpublic）
const protectedPatterns = [
  /^\/inbox/,
  /^\/my/,
  /^\/settings/,
  /^\/[0-9a-f-]+\/project/,  // /:orgId/project/...
]

/** redirect レスポンスに activeOrgId cookie を付与 */
function redirectWithOrgCookie(url: URL, orgId: string): NextResponse {
  const redirectResponse = NextResponse.redirect(url)
  redirectResponse.cookies.set(ACTIVE_ORG_COOKIE, orgId, ACTIVE_ORG_COOKIE_OPTIONS)
  return redirectResponse
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 静的ファイルはスキップ
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[middleware] Missing Supabase env vars')
    return NextResponse.next()
  }

  try {

  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // 公開パスのチェック
  const isPublicPath = pathname === '/' || publicPaths.some(path => pathname.startsWith(path))

  // 保護されたパスのチェック
  const isProtectedPath = protectedPatterns.some(pattern => pattern.test(pathname))

  // 認証が必要なプレフィックスのチェック
  const needsAuth = authRequiredPrefixes.some(prefix => pathname.startsWith(prefix))

  // 認証不要のパスではセッションチェックをスキップ
  // ただし login/signup はリダイレクト判定のため検証が必要
  if (isPublicPath && !isProtectedPath && !needsAuth && pathname !== '/login' && pathname !== '/signup') {
    return response
  }

  // ── 高速パス: login/signup/onboarding 以外 ──
  // getSession() はJWT読み込み（ネットワーク不要、~1ms）※期限切れ時のみrefreshで往復あり
  // getUser() はSupabase Auth APIへ毎回往復（50-200ms）
  //
  // セキュリティモデル:
  // - middlewareはルーティング層（認証済みか否かでページ振り分け）
  // - 実際のセキュリティ境界はSupabase RLS（全データクエリでtoken検証）
  // - cookieはhttpOnly + SameSite + Secureで保護（クライアントJSで改竄不可）
  // - 仮にsessionが不正でも、RLSがデータアクセスをブロック
  const needsServerVerification = pathname === '/login' || pathname === '/signup' || pathname.startsWith('/onboarding')

  if (!needsServerVerification) {
    const { data: { session } } = await supabase.auth.getSession()

    // 未認証ユーザーが保護されたパスにアクセスした場合
    if (!session && (isProtectedPath || needsAuth)) {
      if (pathname === '/portal') {
        return NextResponse.redirect(new URL('/login', request.url))
      }
      const redirectUrl = new URL('/login', request.url)
      redirectUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(redirectUrl)
    }

    // プロジェクトルート (/:orgId/project/...) の場合、URL の orgId を cookie に同期
    if (session) {
      const projectMatch = pathname.match(/^\/([0-9a-f-]+)\/project/)
      if (projectMatch) {
        const pathOrgId = projectMatch[1]
        const cookieOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value
        if (pathOrgId !== cookieOrgId) {
          response.cookies.set(ACTIVE_ORG_COOKIE, pathOrgId, ACTIVE_ORG_COOKIE_OPTIONS)
        }
      }
    }

    return response
  }

  // ── 検証パス: login/signup/onboarding のみ getUser() を使用 ──
  // サーバー検証が必要（リダイレクト先の決定に verified user ID が必要）
  const { data: { user } } = await supabase.auth.getUser()

  // 認証済みユーザーがログイン/サインアップページにアクセスした場合
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const cookieOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value
    const membership = await resolveActiveOrg(supabase, user.id, cookieOrgId)

    if (!membership) {
      return NextResponse.redirect(new URL('/inbox', request.url))
    }

    if (membership.role === 'client') {
      return redirectWithOrgCookie(new URL('/portal', request.url), membership.org_id)
    }

    const { data: space } = await supabase
      .from('spaces')
      .select('id')
      .eq('org_id', membership.org_id)
      .eq('type', 'project')
      .limit(1)
      .single()

    if (space) {
      return redirectWithOrgCookie(
        new URL(`/${membership.org_id}/project/${space.id}`, request.url),
        membership.org_id
      )
    }

    return redirectWithOrgCookie(new URL('/inbox', request.url), membership.org_id)
  }

  // /onboarding ガード
  if (pathname === '/onboarding') {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    const onboardCookieOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value
    const onboardMembership = await resolveActiveOrg(supabase, user.id, onboardCookieOrgId)

    if (onboardMembership) {
      if (onboardMembership.role === 'client') {
        return redirectWithOrgCookie(new URL('/portal', request.url), onboardMembership.org_id)
      }
      const { data: onboardSpace } = await supabase
        .from('spaces')
        .select('id')
        .eq('org_id', onboardMembership.org_id)
        .eq('type', 'project')
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (onboardSpace) {
        return redirectWithOrgCookie(
          new URL(`/${onboardMembership.org_id}/project/${onboardSpace.id}`, request.url),
          onboardMembership.org_id
        )
      }
      return redirectWithOrgCookie(new URL('/inbox', request.url), onboardMembership.org_id)
    }
    return response
  }

  // 未認証で保護パスにいる場合（onboardingは上で処理済み）
  if (!user && isProtectedPath) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return response

  } catch (error) {
    console.error('[middleware] Unhandled error:', error)
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
