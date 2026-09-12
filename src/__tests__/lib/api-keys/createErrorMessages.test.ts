import { describe, it, expect } from 'vitest'
import { describeApiKeyCreateError } from '@/lib/api-keys/createErrorMessages'

describe('describeApiKeyCreateError', () => {
  it('組織またぎのエラーは、日本語で分かりやすく伝える', () => {
    expect(describeApiKeyCreateError('Selected projects must belong to the same organization')).toBe(
      '選んだプロジェクトが複数の組織にまたがっています。1つの組織のプロジェクトだけを選んでください'
    )
  })

  it('未知の理由・未指定は、決まった一般文言に倒す（サーバーの生の文言をそのまま出さない）', () => {
    expect(describeApiKeyCreateError('some unexpected internal detail')).toBe(
      'APIキーの作成に失敗しました'
    )
    expect(describeApiKeyCreateError(undefined)).toBe('APIキーの作成に失敗しました')
  })
})
