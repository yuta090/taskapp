import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ACTIVE_ORG_COOKIE, ACTIVE_ORG_COOKIE_OPTIONS } from '@/lib/org/constants'
import { resolveActiveOrg } from '@/lib/org/resolveActiveOrg'

// 認証不要のパス（ホワイトリスト — ここに無いページは全て認証必須）
// NOTE: /api は静的ファイルスキップで除外済みのためここに不要
const publicPaths = [
  '/',
  '/login',
  '/signup',
  '/reset',
  '/invite',
  '/auth/callback',
  '/docs',
  '/admin/login',
  '/contact',
  '/pricing',
  '/privacy',
  '/terms',
  '/portal/email-action',
  '/lp1', // 静的LP（public/lp1/index.html へ rewrite）
]

/** セグメント境界を考慮したパスマッチ（/privacy が /privacy-policy にマッチしない） */
function isPublicPathMatch(pathname: string): boolean {
  return publicPaths.some(path => {
    if (path === '/') return pathname === '/'
    return pathname === path || pathname.startsWith(path + '/')
  })
}

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

  // ホワイトリスト方式: publicPaths に含まれないパスは全て認証必須
  const isPublic = isPublicPathMatch(pathname)

  // login/signup は認証済みユーザーのリダイレクト判定が必要なので別扱い
  const needsServerVerification = pathname === '/login' || pathname === '/signup' || pathname.startsWith('/onboarding')

  // 公開パス（login/signup/onboarding 以外）はセッションチェック不要
  if (isPublic && !needsServerVerification) {
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
  if (!needsServerVerification) {
    const { data: { session } } = await supabase.auth.getSession()

    // 未認証 → /login にリダイレクト
    if (!session) {
      if (pathname === '/portal') {
        return NextResponse.redirect(new URL('/login', request.url))
      }
      const redirectUrl = new URL('/login', request.url)
      redirectUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
      return NextResponse.redirect(redirectUrl)
    }

    // プロジェクトルート (/:orgId/project/...) の場合、URL の orgId を cookie に同期
    const projectMatch = pathname.match(/^\/([0-9a-f-]+)\/project/)
    if (projectMatch) {
      const pathOrgId = projectMatch[1]
      const cookieOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value
      if (pathOrgId !== cookieOrgId) {
        response.cookies.set(ACTIVE_ORG_COOKIE, pathOrgId, ACTIVE_ORG_COOKIE_OPTIONS)
      }
    }

    return response
  }

  // ── 検証パス: login/signup/onboarding のみ getUser() を使用 ──
  // サーバー検証が必要（リダイレクト先の決定に verified user ID が必要）
  const { data: { user } } = await supabase.auth.getUser()

  // 認証済みユーザーがログイン/サインアップページにアクセスした場合
  if (user && (pathname === '/login' || pathname === '/signup')) {
    // redirect パラメータ付き（招待のログインリンク等）は行き先が明示されているので
    // そちらを優先（auth/callback の next と同じバリデーション）
    const redirectParam = request.nextUrl.searchParams.get('redirect')
    if (
      redirectParam &&
      redirectParam.startsWith('/') &&
      !redirectParam.startsWith('//') &&
      !redirectParam.includes('\\')
    ) {
      return NextResponse.redirect(new URL(redirectParam, request.url))
    }

    const cookieOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value
    const membership = await resolveActiveOrg(supabase, user.id, cookieOrgId)

    // 組織未所属 → オンボーディング（Step1: 組織作成）。
    // LoginClient / auth/callback と同じ判定に揃える（/inbox は組織前提の画面）
    if (!membership) {
      return NextResponse.redirect(new URL('/onboarding', request.url))
    }

    if (membership.role === 'client') {
      // Check if user is a vendor in a space within this org
      const { data: vendorMembership } = await supabase
        .from('space_memberships')
        .select('id, spaces!inner(org_id)')
        .eq('user_id', user.id)
        .eq('role', 'vendor')
        .eq('spaces.org_id', membership.org_id)
        .limit(1)
        .maybeSingle()

      if (vendorMembership) {
        return redirectWithOrgCookie(new URL('/vendor-portal', request.url), membership.org_id)
      }
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

    // 組織はあるがプロジェクトが無い（作成途中で離脱）→ Step2から再開
    return redirectWithOrgCookie(new URL('/onboarding', request.url), membership.org_id)
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
        // Check if user is a vendor in a space within this org
        const { data: onboardVendorMem } = await supabase
          .from('space_memberships')
          .select('id, spaces!inner(org_id)')
          .eq('user_id', user.id)
          .eq('role', 'vendor')
          .eq('spaces.org_id', onboardMembership.org_id)
          .limit(1)
          .maybeSingle()

        if (onboardVendorMem) {
          return redirectWithOrgCookie(new URL('/vendor-portal', request.url), onboardMembership.org_id)
        }
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
      // 組織はあるがプロジェクトが無い → オンボーディング（Step2）をそのまま表示。
      // ここで /inbox に弾くと LoginClient / auth/callback の Step2 再開が到達不能になる
      response.cookies.set(ACTIVE_ORG_COOKIE, onboardMembership.org_id, ACTIVE_ORG_COOKIE_OPTIONS)
      return response
    }
    return response
  }

  return response

  } catch (error) {
    console.error('[middleware] Unhandled error:', error)
    // エラー時は安全側に倒す: 保護パスなら /login にリダイレクト
    if (!isPublicPathMatch(pathname)) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
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
