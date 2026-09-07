import { cookies } from 'next/headers'
import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { DEVICE_COOKIE_NAME, DEVICE_ID_RE, deviceCookieOptions } from '@/lib/auth/deviceCookie'
import { generateDeviceId, notifyNewDevice, recordDeviceLogin } from '@/lib/auth/loginNotify'

export const runtime = 'nodejs'

const RATE_LIMIT = { maxRequests: 5, windowMs: 10 * 60 * 1000 }

/**
 * POST /api/auth/login-notify — なりすましログイン対策「新しい端末からのログイン通知」の受け口。
 *
 * 呼び出し元は src/proxy.ts（門番）の1箇所（Fable裁定: 認証済みで保護ページに来たことを検知できる
 * ここに一本化。パスワードログイン画面・Googleコールバックそれぞれには置かない）。
 * proxy は自分の cookie ヘッダをそのまま転送してくるので、ここでの認証は通常のリクエストと同じ
 * （createClient() が cookie からセッションを読む）。
 *
 * - 端末の cookie（agentpm_device）が無い/形式が壊れていれば、ここで新規発行する
 * - 既知判定・記録は同期で行うが、メール送信は `after()` でレスポンス送出後に回す
 *   （送信の遅延・失敗が proxy 経由のページ表示を遅らせない）
 * - user.id ごとに 5回/10分のレート制限（超過分は記録もしない・429）
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimit = checkRateLimit(`login-notify:${user.id}`, RATE_LIMIT)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 })
  }

  const cookieStore = await cookies()
  const rawDeviceId = cookieStore.get(DEVICE_COOKIE_NAME)?.value
  // 形式が壊れている（改竄・破損）cookie は無かったものとして新規発行する
  const existingDeviceId = rawDeviceId && DEVICE_ID_RE.test(rawDeviceId) ? rawDeviceId : undefined
  const deviceId = existingDeviceId || generateDeviceId()

  const userAgent = request.headers.get('user-agent')
  const { isNew } = await recordDeviceLogin({ userId: user.id, deviceId, userAgent })

  if (isNew) {
    after(() => notifyNewDevice({ email: user.email, userAgent }))
  }

  const response = NextResponse.json({ notified: isNew })
  if (!existingDeviceId) {
    response.cookies.set(DEVICE_COOKIE_NAME, deviceId, deviceCookieOptions())
  }
  return response
}
