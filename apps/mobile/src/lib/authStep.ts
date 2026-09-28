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
