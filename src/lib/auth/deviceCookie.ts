/**
 * 端末識別 cookie（なりすましログイン対策・新しい端末からのログイン通知）の名前・検証・設定値。
 *
 * src/proxy.ts（Edge Runtime）と src/lib/auth/loginNotify.ts / API route（Node.js Runtime）の
 * 両方から import されるため、node:crypto など Node 専用 API には依存しないこと
 * （ランダムな device_id の生成＝generateDeviceId は Node 専用なので loginNotify.ts 側に置く）。
 */

export const DEVICE_COOKIE_NAME = 'agentpm_device'

/** device_id の形式（32byte hex）。cookie 値がこれに合わなければ改竄・破損とみなし新規発行する */
export const DEVICE_ID_RE = /^[0-9a-f]{64}$/

/** 400日（Chrome等の cookie 有効期限の実質上限と同じ長さ） */
const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

export interface DeviceCookieOptions {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

/** ローカル開発（http）でも Set-Cookie が効くよう、本番だけ Secure を付ける */
export function deviceCookieOptions(): DeviceCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  }
}

/**
 * proxy が POST /api/auth/login-notify の呼び出しに失敗/タイムアウトしたときに立てる短命 cookie。
 * これがある間は proxy は再呼び出ししない（DB 不調中に毎リクエスト叩いて悪化させないため）。
 */
export const DEVICE_PENDING_COOKIE_NAME = 'agentpm_device_pending'

const DEVICE_PENDING_COOKIE_MAX_AGE_SECONDS = 5 * 60

export interface DevicePendingCookieOptions {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

export function devicePendingCookieOptions(): DevicePendingCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_PENDING_COOKIE_MAX_AGE_SECONDS,
  }
}
