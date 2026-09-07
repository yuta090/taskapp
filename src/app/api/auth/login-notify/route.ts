import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEVICE_COOKIE_NAME, deviceCookieOptions, generateDeviceId, recordLoginAndNotify } from '@/lib/auth/loginNotify'

export const runtime = 'nodejs'

/**
 * POST /api/auth/login-notify — なりすましログイン対策「新しい端末からのログイン通知」の受け口。
 *
 * パスワードログイン成功直後にクライアントから fire-and-forget で呼ばれる
 * （src/app/(auth)/login/LoginClient.tsx）。Google ログイン（auth/callback）は
 * サーバー側で recordLoginAndNotify を直接呼ぶのでこの API は経由しない。
 *
 * - 端末の cookie（agentpm_device）が無ければここで発行する
 * - 記録・通知の本体は src/lib/auth/loginNotify.ts に共通化
 * - 失敗してもログイン導線には影響させたくないため、呼び出し側は結果を待たない前提
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cookieStore = await cookies()
  const existingDeviceId = cookieStore.get(DEVICE_COOKIE_NAME)?.value
  const deviceId = existingDeviceId || generateDeviceId()

  const result = await recordLoginAndNotify({
    userId: user.id,
    email: user.email,
    deviceId,
    userAgent: request.headers.get('user-agent'),
  })

  const response = NextResponse.json({ notified: result.notified })
  if (!existingDeviceId) {
    response.cookies.set(DEVICE_COOKIE_NAME, deviceId, deviceCookieOptions())
  }
  return response
}
