/**
 * 二要素認証（認証アプリの6桁コード = TOTP）の判定（純粋）。
 *
 * 仕組み: Supabase Auth の MFA。認証アプリを登録した人は、パスワード（or Google）でログインした直後は
 * 「1段階目だけ通った状態」(aal1) で、コードを入れて初めて「2段階目も通った」(aal2) になる。
 * 登録済みの人が aal1 のまま保護ページを開こうとしたら、必ずコード入力画面へ回す（門番 = src/proxy.ts）。
 *
 * 用語: currentLevel = いまのログインの段階、nextLevel = その人が到達すべき段階（登録済みなら aal2）。
 */
import { safeInternalPathOr } from './safeRedirect'

export type AssuranceLevel = 'aal1' | 'aal2' | null | undefined

export const MFA_CHALLENGE_PATH = '/login/mfa'

/** コード入力が要る状態か（登録済み × まだ2段階目を通っていない） */
export function needsMfaChallenge(currentLevel: AssuranceLevel, nextLevel: AssuranceLevel): boolean {
  return nextLevel === 'aal2' && currentLevel !== 'aal2'
}

/** コード入力画面そのものは門番の対象外（無限リダイレクト防止）。ログアウトは POST /api/auth/logout で /api は元々対象外 */
export function isMfaExemptPath(pathname: string): boolean {
  return pathname === MFA_CHALLENGE_PATH || pathname.startsWith(MFA_CHALLENGE_PATH + '/')
}

/**
 * 保護ページへのアクセスをコード入力画面へ回すべきなら、その遷移先を返す（不要なら null）。
 * 元の行き先は redirect に持ち回り、コード入力後に戻す（内部パスのみ）。
 */
export function decideMfaRedirect(input: {
  pathname: string
  search?: string
  currentLevel: AssuranceLevel
  nextLevel: AssuranceLevel
}): string | null {
  if (isMfaExemptPath(input.pathname)) return null
  if (!needsMfaChallenge(input.currentLevel, input.nextLevel)) return null
  const target = `${input.pathname}${input.search ?? ''}`
  return `${MFA_CHALLENGE_PATH}?redirect=${encodeURIComponent(safeInternalPathOr(target))}`
}

/** 認証アプリの表示名（Supabase の friendly_name） */
export const TOTP_FRIENDLY_NAME = '認証アプリ'

/** 6桁コードの入力を整える（全角数字・空白・ハイフン混じりを許す） */
export function normalizeTotpCode(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '')
    .slice(0, 6)
}
