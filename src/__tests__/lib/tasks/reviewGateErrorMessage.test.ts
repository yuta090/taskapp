import { describe, it, expect } from 'vitest'
import { reviewGateErrorMessage } from '@/lib/tasks/reviewGateErrorMessage'

describe('reviewGateErrorMessage', () => {
  it('社内レビュー未承認の例外を分かりやすい日本語に変換する', () => {
    expect(
      reviewGateErrorMessage({ message: 'Cannot complete task: review is not approved' })
    ).toBe('社内レビューが完了していないため承認できません')
  })

  it('spec の決定事項未決の例外を分かりやすい日本語に変換する', () => {
    expect(
      reviewGateErrorMessage({ message: 'Cannot complete task: spec decision is not made' })
    ).toBe('決定事項が未決のため承認できません')
  })

  it('該当しないエラー・エラー無しは null を返す（呼び出し側が汎用メッセージにフォールバックする）', () => {
    expect(reviewGateErrorMessage({ message: 'some other error' })).toBeNull()
    expect(reviewGateErrorMessage(null)).toBeNull()
  })
})
