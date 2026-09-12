import { describe, it, expect } from 'vitest'
import { AUTH_REASON_LABELS, actionNotAllowedReason, scopeRequiredReason } from './authReasonLabels.js'

describe('AUTH_REASON_LABELS', () => {
  it('決まった日本語を持つ', () => {
    expect(AUTH_REASON_LABELS.invalidOrExpiredApiKey).toBe('APIキーが無効か期限切れです')
    expect(AUTH_REASON_LABELS.spaceIdRequired).toBe('spaceId の指定が必要です')
    expect(AUTH_REASON_LABELS.spaceNotAllowed).toBe('このAPIキーで許可されたプロジェクトではありません')
    expect(AUTH_REASON_LABELS.keyNotBoundToSpace).toBe('このAPIキーはどのプロジェクトにも紐づいていません')
    expect(AUTH_REASON_LABELS.keyOwnerNotSet).toBe('このAPIキーに持ち主が設定されていません')
  })
})

describe('actionNotAllowedReason', () => {
  it('操作名を含む日本語にする', () => {
    expect(actionNotAllowedReason('write')).toBe('このAPIキーでは操作「write」を実行できません')
  })
})

describe('scopeRequiredReason', () => {
  it('ツール名・必要なscope・現在のscopeを含む日本語にする', () => {
    expect(scopeRequiredReason('space_list', 'scope=org または scope=user', 'space')).toBe(
      'ツール「space_list」は scope=org または scope=user のAPIキーが必要です（現在のscope: space）',
    )
  })
})
