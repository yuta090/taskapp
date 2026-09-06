import { describe, it, expect } from 'vitest'
import {
  classifyProviderCallbackError,
  sanitizeReason,
  buildLoginErrorPath,
  formatAuthErrorMessage,
} from '@/lib/auth/authErrorMessage'

describe('classifyProviderCallbackError', () => {
  it('access_denied（ユーザーが画面で取り消した）だけをキャンセル扱いにする', () => {
    expect(classifyProviderCallbackError({ error: 'access_denied', errorCode: null })).toEqual({
      loginError: 'auth_cancelled',
      reason: 'access_denied',
    })
  })

  it('それ以外（Supabase/Google側の失敗）はプロバイダエラーとして理由コードを残す', () => {
    expect(
      classifyProviderCallbackError({ error: 'server_error', errorCode: 'unexpected_failure' })
    ).toEqual({ loginError: 'auth_provider_error', reason: 'unexpected_failure' })
  })

  it('error_code が無ければ error を理由にする', () => {
    expect(classifyProviderCallbackError({ error: 'server_error', errorCode: null })).toEqual({
      loginError: 'auth_provider_error',
      reason: 'server_error',
    })
  })
})

describe('sanitizeReason', () => {
  it('英数字・アンダースコア・ハイフン以外は落とし、小文字化する', () => {
    expect(sanitizeReason('Unexpected_Failure')).toBe('unexpected_failure')
    expect(sanitizeReason('<script>alert(1)</script>')).toBe('scriptalert1script')
    expect(sanitizeReason('')).toBeNull()
    expect(sanitizeReason(null)).toBeNull()
    expect(sanitizeReason('!!!')).toBeNull()
  })

  it('64文字で切る（URLとログを汚さない）', () => {
    expect(sanitizeReason('a'.repeat(100))).toHaveLength(64)
  })
})

describe('buildLoginErrorPath', () => {
  it('理由付きのログインURLを作る', () => {
    expect(buildLoginErrorPath({ loginError: 'auth_callback_failed', reason: 'exchange_failed' })).toBe(
      '/login?error=auth_callback_failed&reason=exchange_failed'
    )
  })

  it('理由が無ければ error だけ', () => {
    expect(buildLoginErrorPath({ loginError: 'auth_cancelled' })).toBe('/login?error=auth_cancelled')
  })
})

describe('formatAuthErrorMessage', () => {
  it('キャンセルは従来どおりの文言', () => {
    expect(formatAuthErrorMessage('auth_cancelled', 'access_denied')).toBe('Google認証がキャンセルされました。')
  })

  it('プロバイダエラーは理由コードを添える', () => {
    expect(formatAuthErrorMessage('auth_provider_error', 'unexpected_failure')).toBe(
      'Google認証がGoogle/Supabase側で拒否されました。（理由: unexpected_failure）'
    )
  })

  it('理由コードは無害化してから表示する', () => {
    expect(formatAuthErrorMessage('auth_callback_failed', '<b>x</b>')).toBe(
      'Google認証に失敗しました。もう一度お試しください。（理由: bxb）'
    )
  })

  it('知らない error は空文字（何も出さない）', () => {
    expect(formatAuthErrorMessage('something_else', null)).toBe('')
    expect(formatAuthErrorMessage(null, null)).toBe('')
  })
})
