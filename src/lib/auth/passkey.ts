/**
 * 二要素認証のパスキー（Supabase MFA の webauthn factor）の補助。Web 専用（スマホアプリからは使わない）。
 *
 * 方針: パスキーは「認証アプリ（TOTP）を登録済みの人が、コード入力の代わりに使える追加の手段」。
 * スマホアプリではパスキーを使えないため、パスキーだけが残る状態を作らない
 * （追加は認証アプリ登録済みのときだけ・認証アプリを解除するときはパスキーも全部消す）。
 * 強制（DB の mfa_satisfied・pre-request・API の mfaGuardResponse）は factor の種類を問わず aal2 を見るので、
 * パスキーで確認したセッションもそのまま通る。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

type WebAuthnApi = SupabaseClient['auth']['mfa']['webauthn']
type CreationOverrides = NonNullable<Parameters<WebAuthnApi['register']>[1]>
type RequestOverrides = NonNullable<Parameters<WebAuthnApi['authenticate']>[1]>

/**
 * 登録の上書き。supabase-js の既定（DEFAULT_CREATION_OPTIONS）はセキュリティキー専用
 * （authenticatorAttachment: 'cross-platform'・hints: ['security-key']）で、Mac の Touch ID・Windows Hello・
 * iPhone の Face ID など端末内の認証が選べない。画面の案内（指紋・顔認証・画面ロック）に合わせて端末内に寄せる。
 * attestation は 'none'（認証器の機種情報は使わないので、ブラウザの「機種情報の提供」確認を出さない）
 */
export const PASSKEY_CREATION_OPTIONS: CreationOverrides = {
  authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
  hints: ['client-device'],
  attestation: 'none',
}

/** 確認の上書き。既定の hints: ['security-key'] だと、ブラウザがセキュリティキーの案内を先に出す */
// SDK の型は challenge を必須にしているが、実際は既定・サーバーの値に重ねるだけ（webauthn.js の deepMerge）。
// challenge はサーバーの値を使うので渡さない
export const PASSKEY_REQUEST_OPTIONS = {
  hints: ['client-device'],
  userVerification: 'required',
} as Partial<RequestOverrides> as RequestOverrides

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

export const MFA_LOCK_NAME = 'taskapp-mfa-factors'

/**
 * 同じブラウザの別タブ同士で、factor の追加・削除・解除を1つずつ行う（Web Locks）。
 * 例: 解除側が一覧を取った直後に別タブでパスキーが足されると、パスキーだけが残る。
 * 端末をまたぐ同時操作は防げない（サーバー側の制御が要る）。残った場合は設定画面が認証アプリの登録し直しを案内する
 */
export async function withMfaLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: { request?: unknown } }).locks : undefined
  if (!locks || typeof locks.request !== 'function') return fn()
  return (locks as LockManager).request(MFA_LOCK_NAME, fn) as Promise<T>
}
