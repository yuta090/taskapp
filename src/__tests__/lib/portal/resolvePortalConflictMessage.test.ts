import { describe, it, expect } from 'vitest'
import { resolvePortalConflictMessage } from '@/lib/portal/resolvePortalConflictMessage'

describe('resolvePortalConflictMessage', () => {
  const fallback = '他のユーザーが先に操作しました。画面を更新します。'

  it('APIが理由付き(reason=blocked)の文言を返したときは、それをそのまま使う', () => {
    expect(
      resolvePortalConflictMessage(
        { error: '社内レビューが完了していないため承認できません', reason: 'blocked' },
        fallback
      )
    ).toBe('社内レビューが完了していないため承認できません')
  })

  it('reason が無ければ、本当に先に操作された場合として渡された既定文言を使う', () => {
    expect(
      resolvePortalConflictMessage({ error: 'タスクの状態が変更されました。ページを再読み込みしてください。' }, fallback)
    ).toBe(fallback)
  })

  it('reason=blocked でも error 本文が無ければ既定文言にフォールバックする', () => {
    expect(resolvePortalConflictMessage({ reason: 'blocked' }, fallback)).toBe(fallback)
  })

  it('本文が空/JSON解析失敗などで空オブジェクトのときも既定文言にフォールバックする', () => {
    expect(resolvePortalConflictMessage({}, fallback)).toBe(fallback)
  })
})
