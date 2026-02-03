import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// 認証不要のパス
const publicPaths = [
  '/login',
  '/signup',
  '/reset',
  '/invite',
  '/portal',
  '/api/auth',
]

// 認証が必要なパス（これ以外はpublic）
const protectedPatterns = [
  /^\/inbox/,
  /^\/my/,
  /^\/[0-9a-f-]+\/project/,  // /:orgId/project/...
]

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

  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // セッションをリフレッシュ
  const { data: { user } } = await supabase.auth.getUser()

  // 公開パスのチェック
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

  // 保護されたパスのチェック
  const isProtectedPath = protectedPatterns.some(pattern => pattern.test(pathname))

  // 認証済みユーザーがログイン/サインアップページにアクセスした場合
  if (user && (pathname === '/login' || pathname === '/signup')) {
    // ユーザーのロールを確認してリダイレクト先を決定
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (membership?.role === 'client') {
      return NextResponse.redirect(new URL('/portal', request.url))
    } else if (membership) {
      const { data: space } = await supabase
        .from('spaces')
        .select('id')
        .eq('org_id', membership.org_id)
        .eq('type', 'project')
        .limit(1)
        .single()

      if (space) {
        return NextResponse.redirect(
          new URL(`/${membership.org_id}/project/${space.id}`, request.url)
        )
      }
    }

    return NextResponse.redirect(new URL('/inbox', request.url))
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

  return response
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
