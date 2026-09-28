import { describe, expect, it } from 'vitest'
import { resolveAuthStep } from './authStep'

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
