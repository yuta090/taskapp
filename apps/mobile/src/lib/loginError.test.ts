import { describe, expect, it } from 'vitest'
import { loginErrorMessage } from './loginError'

describe('loginErrorMessage', () => {
  it('メールアドレスかパスワードが違うときだけ、そう伝える', () => {
    expect(loginErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'メールアドレスかパスワードが違います'
    )
    expect(loginErrorMessage({ message: 'Invalid login credentials' })).toBe('メールアドレスかパスワードが違います')
  })
  it('メールの確認が済んでいない', () => {
    expect(loginErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toBe(
      'メールアドレスの確認が済んでいません。届いたメールのリンクを開いてください'
    )
  })
  it('試しすぎ', () => {
    expect(loginErrorMessage({ status: 429, message: 'rate limit' })).toBe(
      'ログインの試行が多すぎます。しばらく待ってからお試しください'
    )
  })
  it('通信エラーなどそれ以外は、パスワードのせいにしない', () => {
    expect(loginErrorMessage({ message: 'Network request failed' })).toBe(
      'ログインできませんでした。通信の状態を確かめて、もう一度お試しください'
    )
  })
})
