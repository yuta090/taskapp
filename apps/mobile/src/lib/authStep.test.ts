import { describe, expect, it } from 'vitest'
import { assuranceFromSession, resolveAuthStep } from './authStep'

describe('resolveAuthStep', () => {
  it('セッションが無ければログイン画面', () => {
    expect(resolveAuthStep({ hasSession: false, aal: null })).toBe('signedOut')
  })
  it('2段階認証を登録している人が、まだ2段階目を通していなければ確認コード画面', () => {
    expect(resolveAuthStep({ hasSession: true, aal: { currentLevel: 'aal1', nextLevel: 'aal2' } })).toBe('mfa')
  })
  it('2段階目まで通っていれば使える', () => {
    expect(resolveAuthStep({ hasSession: true, aal: { currentLevel: 'aal2', nextLevel: 'aal2' } })).toBe('ready')
  })
  it('2段階認証を使っていない人はそのまま使える', () => {
    expect(resolveAuthStep({ hasSession: true, aal: { currentLevel: 'aal1', nextLevel: 'aal1' } })).toBe('ready')
  })
  it('認証の段階を確かめられなかったら、確かめ終わるまで待つ（RLS に弾かれる画面を出さない）', () => {
    expect(resolveAuthStep({ hasSession: true, aal: null })).toBe('checking')
  })
})

describe('assuranceFromSession', () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = (payload: object) => `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`

  it('トークンの aal を今の段階にする（auth-js と同じ計算・通信なし）', () => {
    expect(assuranceFromSession({ access_token: jwt({ aal: 'aal1' }), user: { factors: [] } })).toEqual({
      currentLevel: 'aal1',
      nextLevel: 'aal1',
    })
  })
  it('検証済みの2段階認証があれば、次の段階は aal2', () => {
    expect(
      assuranceFromSession({ access_token: jwt({ aal: 'aal1' }), user: { factors: [{ status: 'verified' }] } })
    ).toEqual({ currentLevel: 'aal1', nextLevel: 'aal2' })
  })
  it('登録途中（未検証）の2段階認証は数えない', () => {
    expect(
      assuranceFromSession({ access_token: jwt({ aal: 'aal1' }), user: { factors: [{ status: 'unverified' }] } })
    ).toEqual({ currentLevel: 'aal1', nextLevel: 'aal1' })
  })
  it('トークンが読めなければ null（使える判定にしない）', () => {
    expect(assuranceFromSession({ access_token: 'broken', user: {} })).toBeNull()
  })
})

describe('assuranceFromSession — 形のおかしいトークン', () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  it('3つに分かれていない・中身が配列なら null（使える判定にしない）', () => {
    expect(assuranceFromSession({ access_token: 'a.b', user: {} })).toBeNull()
    expect(assuranceFromSession({ access_token: `h.${b64([1, 2])}.s`, user: {} })).toBeNull()
    expect(assuranceFromSession({ access_token: 'h.%%%.s', user: {} })).toBeNull()
  })
})
