import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ACTIVE_ORG_COOKIE, ACTIVE_ORG_COOKIE_OPTIONS } from '@/lib/org/constants'
import { resolveActiveOrg } from '@/lib/org/resolveActiveOrg'
// 公開パス定義はダークテーマ判定と単一ソース化（src/lib/routes/publicPaths.ts）
import { isPublicPathMatch } from '@/lib/routes/publicPaths'
import { decideMfaRedirect, MFA_CHALLENGE_PATH } from '@/lib/auth/mfa'
import { isSafeInternalPath } from '@/lib/auth/safeRedirect'
import {
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_COOKIE_MAX_AGE_SEC,
  extractFirstTouch,
  encodeFirstTouchCookie,
} from '@/lib/acquisition/firstTouch'
import { DEVICE_COOKIE_NAME, DEVICE_PENDING_COOKIE_NAME, devicePendingCookieOptions } from '@/lib/auth/deviceCookie'

// このファイルは必ず src/ 直下に置く（src/app と同階層）。
// リポジトリルートに置くと `next dev` が読み込まず、認証ゲートがローカルだけ無効になる
// （ビルドは拾うため本番との差分に気づけない）。Next 16 で middleware.ts → proxy.ts に改称。

// 公開パス（publicPaths / STATIC_LP_PATTERN / isPublicPathMatch）は
// src/lib/routes/publicPaths.ts に集約（ダークテーマ判定と単一ソース）。

/** redirect レスポンスに activeOrgId cookie を付与 */
function redirectWithOrgCookie(url: URL, orgId: string): NextResponse {
  const redirectResponse = NextResponse.redirect(url)
  redirectResponse.cookies.set(ACTIVE_ORG_COOKIE, orgId, ACTIVE_ORG_COOKIE_OPTIONS)
  return redirectResponse
}

/**
 * 流入経路（どこから来たか）の first-touch cookie を、門番の判定結果（next / redirect）を問わず付ける。
 * - 既に cookie があれば触らない（最初の訪問を守る）
 * - URL に utm_* / ref / 広告クリック ID が無く、外部サイトからの参照元も無ければ何もしない
 * - 失敗しても門番の判定は変えない（分析のために導線を止めない）
 * cookie は組織作成時（onboarding）に読んで org_acquisition に記録する。
 */
function attachFirstTouchCookie(request: NextRequest, response: NextResponse): void {
  try {
    const { pathname } = request.nextUrl
    if (request.method !== 'GET') return
    if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) return
    // ログインの戻り（/auth/callback 等）は「訪問」ではない。参照元が認証事業者になるので cookie を置かない
    if (pathname.startsWith('/auth')) return
    if (request.cookies.has(FIRST_TOUCH_COOKIE)) return
    // timestamptz に渡す完全な時刻なので日付ずれ(toISOString禁止ルール)の対象外
    const firstTouch = extractFirstTouch(request.nextUrl, request.headers.get('referer'), new Date().toISOString())
    if (!firstTouch) return
    response.cookies.set(FIRST_TOUCH_COOKIE, encodeFirstTouchCookie(firstTouch), {
      maxAge: FIRST_TOUCH_COOKIE_MAX_AGE_SEC,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      // onboarding（クライアント側）が読むので httpOnly にしない。中身は流入元の情報だけで秘密ではない
      httpOnly: false,
    })
  } catch (error) {
    console.warn('[middleware] first-touch cookie skipped:', error)
  }
}

/**
 * なりすましログイン対策: 新しい端末からの初回ログインを検知して本人に通知する（内部API 呼び出し）。
 *
 * "認証済みで保護ページに来た" ことを検知できるここ（門番）に一本化している（Fable裁定 2026-09-07。
 * ログイン画面・Googleコールバックそれぞれに実装すると経路が増えるたびに対応が要るため）。
 * 判定・記録・送信の本体は src/lib/auth/loginNotify.ts（同ファイル冒頭に検知の限界を明記）。
 *
 * - 端末 cookie（agentpm_device）が既にあれば何もしない（速いパス。fetch すら発生しない）
 * - 直近の呼び出しが失敗/タイムアウトしていれば（pending cookie）、5分間は再呼び出ししない
 *   （DB不調中に毎リクエスト叩いて悪化させないため）
 * - 呼び出し自体・応答の失敗は握りつぶす（ログのみ）。ページ表示を絶対に止めない
 */
async function notifyIfNewDevice(request: NextRequest, response: NextResponse): Promise<void> {
  if (request.cookies.has(DEVICE_COOKIE_NAME)) return
  if (request.cookies.has(DEVICE_PENDING_COOKIE_NAME)) return

  try {
    const notifyUrl = new URL('/api/auth/login-notify', request.url)
    const apiResponse = await fetch(notifyUrl, {
      method: 'POST',
      headers: { cookie: request.headers.get('cookie') ?? '' },
      signal: AbortSignal.timeout(3000),
    })

    if (!apiResponse.ok) {
      response.cookies.set(DEVICE_PENDING_COOKIE_NAME, '1', devicePendingCookieOptions())
      return
    }

    const setCookie = apiResponse.headers.get('set-cookie')
    if (setCookie) response.headers.append('set-cookie', setCookie)
  } catch (error) {
    console.warn('[middleware] login-notify skipped:', error)
    response.cookies.set(DEVICE_PENDING_COOKIE_NAME, '1', devicePendingCookieOptions())
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = await proxyCore(request)
  attachFirstTouchCookie(request, response)
  return response
}

async function proxyCore(request: NextRequest): Promise<NextResponse> {
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

    // 二要素認証: 認証アプリ登録済みの人が、コード入力前(aal1)のまま保護ページを開こうとしたらコード入力画面へ。
    // getAuthenticatorAssuranceLevel は cookie の JWT と user.factors から判定するだけ（ネット往復なし）
    // ⚠ ここは cookie の中身（署名の無い user.factors）で判定する「画面の誘導」。本当の強制は
    //   API 側（src/lib/auth/requireAal2.ts / verifySuperadmin）で行う。判定できない（エラー）場合は
    //   従来の保護レベルに落ちるのを避け、ログインし直してもらう（fail-closed）
    try {
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aalError) throw aalError
      const mfaRedirect = decideMfaRedirect({
        pathname,
        search: request.nextUrl.search,
        currentLevel: aal?.currentLevel ?? null,
        nextLevel: aal?.nextLevel ?? null,
      })
      if (mfaRedirect) {
        return NextResponse.redirect(new URL(mfaRedirect, request.url))
      }
    } catch (err) {
      console.error('[middleware] mfa level check failed', err)
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
      loginUrl.searchParams.set('reason', 'mfa_check_failed')
      return NextResponse.redirect(loginUrl)
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

    // なりすましログイン対策: 保護ページに認証済みで来た＝ログイン直後の可能性があるタイミングで検知する
    await notifyIfNewDevice(request, response)

    return response
  }

  // ── 検証パス: login/signup/onboarding のみ getUser() を使用 ──
  // サーバー検証が必要（リダイレクト先の決定に verified user ID が必要）
  const { data: { user } } = await supabase.auth.getUser()

  // 二要素認証を登録済み × コード未入力なら、着地判定（組織の照会。aal1 では RLS で読めず
  // 「組織なし」に化ける）より先にコード入力画面へ
  if (user) {
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    // 判定できないときもコード入力画面へ倒す（fail-closed。未登録なら画面側で判定し直して先へ進む）
    const mfaRedirect = aalError
      ? `${MFA_CHALLENGE_PATH}?redirect=${encodeURIComponent(pathname + request.nextUrl.search)}`
      : decideMfaRedirect({ pathname, search: request.nextUrl.search, currentLevel: aal?.currentLevel ?? null, nextLevel: aal?.nextLevel ?? null })
    if (mfaRedirect && pathname !== '/login' && pathname !== '/signup') {
      return NextResponse.redirect(new URL(mfaRedirect, request.url))
    }
    if (mfaRedirect) {
      // /login 自体の再訪: 元の redirect を持ち回ってコード入力へ
      const redirectParam = request.nextUrl.searchParams.get('redirect')
      const url = new URL(MFA_CHALLENGE_PATH, request.url)
      if (isSafeInternalPath(redirectParam)) url.searchParams.set('redirect', redirectParam)
      return NextResponse.redirect(url)
    }
  }

  // 認証済みユーザーがログイン/サインアップページにアクセスした場合
  if (user && (pathname === '/login' || pathname === '/signup')) {
    // redirect パラメータ付き（招待のログインリンク等）は行き先が明示されているので
    // そちらを優先（auth/callback の next と同じバリデーション）
    const redirectParam = request.nextUrl.searchParams.get('redirect')
    if (isSafeInternalPath(redirectParam)) {
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
