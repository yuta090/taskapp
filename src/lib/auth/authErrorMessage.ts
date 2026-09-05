/**
 * OAuth コールバック失敗の分類と、ログイン画面に出す文言。
 *
 * サーバー（/auth/callback）とクライアント（LoginClient）の両方から使う純粋関数のみ。
 * ここに Supabase クライアント等の副作用は置かない。
 */

export type LoginErrorKind = 'auth_cancelled' | 'auth_provider_error' | 'auth_callback_failed'

export interface CallbackFailure {
  loginError: LoginErrorKind
  /** URL に載せる理由コード（sanitizeReason 済みの想定） */
  reason?: string
}

const REASON_MAX = 64

/** URL・画面に載せる理由コードを無害化する: [a-z0-9_-] のみ・小文字・64文字まで。空なら null */
export function sanitizeReason(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, REASON_MAX)
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Supabase/Google から `?error=...` 付きで戻ってきたときの分類。
 * ユーザーが Google の画面で取り消したときだけ access_denied になる。
 * それ以外（server_error 等）は設定不備（合鍵違い・戻り先未登録）の可能性が高いので
 * 「キャンセル」と言わず、error_code をそのまま理由として残す。
 */
export function classifyProviderCallbackError(params: {
  error: string
  errorCode: string | null
}): CallbackFailure {
  const reason = sanitizeReason(params.errorCode) ?? sanitizeReason(params.error) ?? undefined
  if (params.error === 'access_denied') {
    return { loginError: 'auth_cancelled', reason }
  }
  return { loginError: 'auth_provider_error', reason }
}

export function buildLoginErrorPath(failure: CallbackFailure): string {
  const params = new URLSearchParams({ error: failure.loginError })
  const reason = sanitizeReason(failure.reason)
  if (reason) params.set('reason', reason)
  return `/login?${params.toString()}`
}

const AUTH_ERROR_MESSAGES: Record<LoginErrorKind, string> = {
  auth_cancelled: 'Google認証がキャンセルされました。',
  auth_provider_error: 'Google認証がGoogle/Supabase側で拒否されました。',
  auth_callback_failed: 'Google認証に失敗しました。もう一度お試しください。',
}

function isLoginErrorKind(value: string): value is LoginErrorKind {
  return value in AUTH_ERROR_MESSAGES
}

/** ログイン画面の表示文言。キャンセル以外は理由コードを添えて、問い合わせ時に特定できるようにする */
export function formatAuthErrorMessage(error: string | null, reason: string | null): string {
  if (!error || !isLoginErrorKind(error)) return ''
  const base = AUTH_ERROR_MESSAGES[error]
  if (error === 'auth_cancelled') return base
  const safeReason = sanitizeReason(reason)
  return safeReason ? `${base}（理由: ${safeReason}）` : base
}
