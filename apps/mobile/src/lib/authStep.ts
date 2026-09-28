/**
 * ログインのどの段階にいるか。
 *
 * 2段階認証（TOTP）を登録している人は、2段階目を通すまで DB（RLS）が読み書きを拒否する
 * （supabase/migrations/20260907142526_mfa_rls_enforcement.sql）。なので「セッションがある」
 * だけで一覧を出すと、空・エラーの画面になる。段階を確かめてから画面を決める。
 */

export type AuthStep = 'signedOut' | 'checking' | 'mfa' | 'ready'

export interface AssuranceLevel {
  currentLevel: string | null
  nextLevel: string | null
}

export function resolveAuthStep(input: { hasSession: boolean; aal: AssuranceLevel | null }): AuthStep {
  if (!input.hasSession) return 'signedOut'
  if (!input.aal) return 'checking'
  if (input.aal.nextLevel === 'aal2' && input.aal.currentLevel !== 'aal2') return 'mfa'
  return 'ready'
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const json = decodeURIComponent(
      Array.from(atob(base64), (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    )
    const payload: unknown = JSON.parse(json)
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * セッションから2段階認証の段階を求める。auth-js の getAuthenticatorAssuranceLevel（JWT を渡さない経路）と
 * 同じ計算を、通信なしで同期的に行う。問い合わせにすると、トークンが更新されるたびに一瞬「確かめ中」に戻り、
 * 開いていた画面が閉じてしまうため。
 */
export function assuranceFromSession(session: {
  access_token: string
  user: { factors?: readonly { status: string }[] | null }
}): AssuranceLevel | null {
  const payload = decodeJwtPayload(session.access_token)
  if (!payload) return null
  const currentLevel = typeof payload.aal === 'string' ? payload.aal : null
  const hasVerifiedFactor = (session.user.factors ?? []).some((f) => f.status === 'verified')
  return { currentLevel, nextLevel: hasVerifiedFactor ? 'aal2' : currentLevel }
}
