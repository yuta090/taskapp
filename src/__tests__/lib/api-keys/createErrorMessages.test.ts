import { describe, it, expect } from 'vitest'
import { describeApiKeyCreateError } from '@/lib/api-keys/createErrorMessages'

describe('describeApiKeyCreateError', () => {
  it('組織またぎのエラーは、日本語で分かりやすく伝える', () => {
    expect(describeApiKeyCreateError('Selected projects must belong to the same organization')).toBe(
      '選んだプロジェクトが複数の組織にまたがっています。1つの組織のプロジェクトだけを選んでください'
    )
  })

  it('必須項目が無い場合は、キー名とプロジェクトの入力を促す', () => {
    expect(describeApiKeyCreateError('Missing required fields')).toBe(
      'キー名と、アクセス許可するプロジェクトを入力してください'
    )
  })

  it('許可する操作の指定が不正な場合は、その旨を伝える', () => {
    expect(describeApiKeyCreateError('Invalid allowedActions')).toBe(
      '許可する操作の指定が正しくありません'
    )
  })

  it('未知の理由・未指定は、決まった一般文言に倒す（サーバーの生の文言をそのまま出さない）', () => {
    expect(describeApiKeyCreateError('some unexpected internal detail')).toBe(
      'APIキーの作成に失敗しました'
    )
    expect(describeApiKeyCreateError(undefined)).toBe('APIキーの作成に失敗しました')
  })
})
