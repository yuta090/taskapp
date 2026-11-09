import { describe, it, expect, afterEach } from 'vitest'
import { isPasskeySupported, passkeyFriendlyName, verifiedPasskeys, hasVerifiedTotp } from './passkey'

describe('passkey（二要素認証のパスキー）', () => {
  const original = (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
  afterEach(() => {
    ;(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = original
  })

  it('ブラウザに PublicKeyCredential があるときだけ使える', () => {
    ;(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = undefined
    expect(isPasskeySupported()).toBe(false)
    ;(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = function PublicKeyCredential() {}
    expect(isPasskeySupported()).toBe(true)
  })

  it('表示名は日時＋ランダムな8文字で一意にする（同名だと SDK が登録失敗時に確認済みの同名パスキーまで消す）', () => {
    expect(passkeyFriendlyName(new Date(2026, 10, 10, 9, 5, 7), 'ab12cd34')).toBe('パスキー 2026/11/10 09:05 (ab12cd34)')
    const a = passkeyFriendlyName(new Date(2026, 10, 10, 9, 5, 7))
    const b = passkeyFriendlyName(new Date(2026, 10, 10, 9, 5, 7))
    expect(a).toMatch(/^パスキー 2026\/11\/10 09:05 \([0-9a-f]{8}\)$/)
    expect(a).not.toBe(b)
  })

  it('確認済みのパスキーだけを登録順に並べる', () => {
    const all = [
      { id: 'w2', status: 'verified', factor_type: 'webauthn', friendly_name: 'B', created_at: '2026-11-02T00:00:00Z' },
      { id: 't1', status: 'verified', factor_type: 'totp', friendly_name: '認証アプリ', created_at: '2026-10-01T00:00:00Z' },
      { id: 'w3', status: 'unverified', factor_type: 'webauthn', friendly_name: 'C', created_at: '2026-11-03T00:00:00Z' },
      { id: 'w1', status: 'verified', factor_type: 'webauthn', friendly_name: 'A', created_at: '2026-11-01T00:00:00Z' },
    ]
    expect(verifiedPasskeys(all).map((f) => f.id)).toEqual(['w1', 'w2'])
    expect(hasVerifiedTotp(all)).toBe(true)
    expect(hasVerifiedTotp(all.filter((f) => f.factor_type !== 'totp'))).toBe(false)
  })
})
