import { describe, it, expect } from 'vitest'
import { decideMfaRedirect, isMfaExemptPath, needsMfaChallenge, normalizeTotpCode } from './mfa'

describe('needsMfaChallenge', () => {
  it('登録済み(nextLevel=aal2)で、まだ aal2 でなければコード入力が要る', () => {
    expect(needsMfaChallenge('aal1', 'aal2')).toBe(true)
    expect(needsMfaChallenge(null, 'aal2')).toBe(true)
    expect(needsMfaChallenge('aal2', 'aal2')).toBe(false)
  })
  it('未登録(nextLevel=aal1)なら要らない', () => {
    expect(needsMfaChallenge('aal1', 'aal1')).toBe(false)
    expect(needsMfaChallenge(null, null)).toBe(false)
  })
})

describe('decideMfaRedirect', () => {
  it('保護ページ → コード入力画面へ、元の行き先を redirect に持ち回る', () => {
    expect(decideMfaRedirect({ pathname: '/inbox', search: '?x=1', currentLevel: 'aal1', nextLevel: 'aal2' })).toBe('/login/mfa?redirect=%2Finbox%3Fx%3D1')
  })
  it('コード入力画面・ログアウトは対象外（無限ループ防止）', () => {
    expect(decideMfaRedirect({ pathname: '/login/mfa', currentLevel: 'aal1', nextLevel: 'aal2' })).toBeNull()
    expect(decideMfaRedirect({ pathname: '/logout', currentLevel: 'aal1', nextLevel: 'aal2' })).toBeNull()
    expect(isMfaExemptPath('/login/mfa/')).toBe(true)
  })
  it('要らないときは null', () => {
    expect(decideMfaRedirect({ pathname: '/inbox', currentLevel: 'aal2', nextLevel: 'aal2' })).toBeNull()
    expect(decideMfaRedirect({ pathname: '/inbox', currentLevel: 'aal1', nextLevel: 'aal1' })).toBeNull()
  })
})

describe('normalizeTotpCode', () => {
  it('全角・空白・ハイフンを除いて6桁に', () => {
    expect(normalizeTotpCode('１２3 4-56')).toBe('123456')
    expect(normalizeTotpCode('1234567')).toBe('123456')
    expect(normalizeTotpCode('abc')).toBe('')
  })
})
