import { describe, it, expect } from 'vitest'
import { emailsMatch, shouldAutoAcceptInvite } from '@/lib/invite/emailMatch'

describe('招待メール一致判定 (V5: wrong-account join 防止)', () => {
  describe('emailsMatch', () => {
    it('大文字小文字・前後空白を無視して一致を判定する', () => {
      expect(emailsMatch('User@Example.com', ' user@example.com ')).toBe(true)
    })
    it('異なるメールは不一致', () => {
      expect(emailsMatch('a@example.com', 'b@example.com')).toBe(false)
    })
    it('null/undefined/空 は不一致扱い', () => {
      expect(emailsMatch(null, 'a@example.com')).toBe(false)
      expect(emailsMatch('a@example.com', undefined)).toBe(false)
      expect(emailsMatch('', 'a@example.com')).toBe(false)
    })
  })

  describe('shouldAutoAcceptInvite', () => {
    it('一致すれば自動承認してよい', () => {
      expect(shouldAutoAcceptInvite('invited@example.com', 'invited@example.com')).toBe(true)
    })
    it('別アカウント(不一致)では自動承認しない', () => {
      expect(shouldAutoAcceptInvite('other@example.com', 'invited@example.com')).toBe(false)
    })
    it('セッションのメール不明では自動承認しない', () => {
      expect(shouldAutoAcceptInvite(null, 'invited@example.com')).toBe(false)
    })
  })
})
