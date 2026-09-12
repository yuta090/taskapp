import { describe, it, expect } from 'vitest'
import { describeAcceptInviteError, isMfaRequiredError } from '@/lib/invite/acceptErrorMessage'

describe('describeAcceptInviteError', () => {
  it('message があれば message を優先する（二要素認証の案内など）', () => {
    expect(
      describeAcceptInviteError({ error: 'mfa_required', message: '二要素認証のコード入力が必要です' }, 'エラーが発生しました')
    ).toBe('二要素認証のコード入力が必要です')
  })

  it('message が無ければ error を使う', () => {
    expect(describeAcceptInviteError({ error: '招待リンクが無効または期限切れです' }, 'エラーが発生しました')).toBe(
      '招待リンクが無効または期限切れです'
    )
  })

  it('どちらも無ければ fallback にする', () => {
    expect(describeAcceptInviteError({}, 'エラーが発生しました')).toBe('エラーが発生しました')
    expect(describeAcceptInviteError(null, 'エラーが発生しました')).toBe('エラーが発生しました')
    expect(describeAcceptInviteError(undefined, 'エラーが発生しました')).toBe('エラーが発生しました')
  })
})

describe('isMfaRequiredError', () => {
  it('error が mfa_required なら true', () => {
    expect(isMfaRequiredError({ error: 'mfa_required' })).toBe(true)
  })

  it('それ以外・無ければ false', () => {
    expect(isMfaRequiredError({ error: '招待リンクが無効または期限切れです' })).toBe(false)
    expect(isMfaRequiredError({})).toBe(false)
    expect(isMfaRequiredError(null)).toBe(false)
  })
})
