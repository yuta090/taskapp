import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
  /^\/[0-9a-f-]+\/project/,  // /:orgId/project/...
]

/** redirect レスポンスに activeOrgId cookie を付与 */
function redirectWithOrgCookie(url: URL, orgId: string): NextResponse {
  const redirectResponse = NextResponse.redirect(url)
  redirectResponse.cookies.set('taskapp:activeOrgId', orgId, {
    path: '/',
    sameSite: 'lax',
    maxAge: 31536000,
  })
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

  // 認証不要のパスではgetUser()をスキップ（DB往復を削減）
  // ただし login/signup はリダイレクト判定のためgetUser()必要
  if (isPublicPath && !isProtectedPath && !needsAuth && pathname !== '/login' && pathname !== '/signup') {
    return response
  }

  // セッションをリフレッシュ
  const { data: { user } } = await supabase.auth.getUser()

  // 認証済みユーザーがログイン/サインアップページにアクセスした場合
  if (user && (pathname === '/login' || pathname === '/signup')) {
    // activeOrgId cookie を読み取り、有効なメンバーシップを特定
    const activeOrgId = request.cookies.get('taskapp:activeOrgId')?.value
    let membership: { org_id: string; role: string } | null = null

    if (activeOrgId) {
      const { data } = await supabase
        .from('org_memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .eq('org_id', activeOrgId)
        .single()
      if (data) membership = data
    }

    // cookie が無効 or 未設定 → 最初の組織にフォールバック
    if (!membership) {
      const { data } = await supabase
        .from('org_memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
      membership = data
    }

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
    // activeOrgId cookie を考慮してメンバーシップ検証
    const onboardActiveOrgId = request.cookies.get('taskapp:activeOrgId')?.value
    let onboardMembership: { org_id: string; role: string } | null = null

    if (onboardActiveOrgId) {
      const { data } = await supabase
        .from('org_memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .eq('org_id', onboardActiveOrgId)
        .maybeSingle()
      if (data) onboardMembership = data
    }

    if (!onboardMembership) {
      const { data, error: onboardError } = await supabase
        .from('org_memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (onboardError) {
        return response
      }
      onboardMembership = data
    }

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
    // membership無し → onboardingを表示（正常フロー）
    return response
  }

  // 未認証ユーザーが保護されたパスにアクセスした場合
  if (!user && isProtectedPath) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // /portal（認証済みクライアントダッシュボード）へのアクセス
  if (pathname === '/portal' && !user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // プロジェクトルート (/:orgId/project/...) の場合、URL の orgId を cookie に同期
  if (user) {
    const projectMatch = pathname.match(/^\/([0-9a-f-]+)\/project/)
    if (projectMatch) {
      const pathOrgId = projectMatch[1]
      const cookieOrgId = request.cookies.get('taskapp:activeOrgId')?.value
      if (pathOrgId !== cookieOrgId) {
        response.cookies.set('taskapp:activeOrgId', pathOrgId, {
          path: '/',
          sameSite: 'lax',
          maxAge: 31536000,
        })
      }
    }
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
