/**
 * 二要素認証のパスキー（Supabase MFA の webauthn factor）の補助。Web 専用（スマホアプリからは使わない）。
 *
 * 方針: パスキーは「認証アプリ（TOTP）を登録済みの人が、コード入力の代わりに使える追加の手段」。
 * スマホアプリではパスキーを使えないため、パスキーだけが残る状態を作らない
 * （追加は認証アプリ登録済みのときだけ・認証アプリを解除するときはパスキーも全部消す）。
 * 強制（DB の mfa_satisfied・pre-request・API の mfaGuardResponse）は factor の種類を問わず aal2 を見るので、
 * パスキーで確認したセッションもそのまま通る。
 */

type FactorLike = { id: string; status: string; factor_type: string; friendly_name?: string; created_at?: string }

/** このブラウザでパスキー（WebAuthn）を使えるか */
export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'function'
}

/**
 * 表示名は日時＋ランダムな8文字で一意にする。Supabase は同じ表示名の factor を拒むうえ、
 * supabase-js の register は登録に失敗すると「同じ表示名の確認済みパスキー」を消しにいく（webauthn.js の _register）。
 * 名前がぶつかると、既にあるパスキーを失う
 */
export function passkeyFriendlyName(now: Date, suffix: string = crypto.randomUUID().slice(0, 8)): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `パスキー ${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())} (${suffix})`
}

/** 確認済みのパスキーを登録順に */
export function verifiedPasskeys<T extends FactorLike>(all: readonly T[]): T[] {
  return all
    .filter((f) => f.factor_type === 'webauthn' && f.status === 'verified')
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
}

export function hasVerifiedTotp(all: readonly FactorLike[]): boolean {
  return all.some((f) => f.factor_type === 'totp' && f.status === 'verified')
}
