import { describe, expect, it } from 'vitest'
import { classifyCompleteFailure, completeFailureMessage } from '@/lib/minutes/taskActions'

describe('完了できなかった理由の読み取り', () => {
  it('決定事項がまだ決まっていない', () => {
    expect(classifyCompleteFailure('Cannot complete task: spec decision is not made')).toBe('spec_undecided')
  })

  it('社内の承認が終わっていない', () => {
    expect(classifyCompleteFailure('Cannot complete task: review is not approved')).toBe('review_pending')
  })

  it('DB のメッセージに前置きが付いていても読み取れる', () => {
    expect(
      classifyCompleteFailure('new row violates ... Cannot complete task: spec decision is not made')
    ).toBe('spec_undecided')
  })

  it('知らない理由は unknown', () => {
    expect(classifyCompleteFailure('something else')).toBe('unknown')
    expect(classifyCompleteFailure('')).toBe('unknown')
  })
})

describe('完了できなかったときの言い方', () => {
  it('決まっていないときは、次にすることを書く', () => {
    const message = completeFailureMessage('spec_undecided')
    expect(message).toContain('決定事項のタスク')
    expect(message).toContain('決定にする')
    // 英語のまま出さない
    expect(message).not.toContain('Cannot complete')
  })

  it('承認待ちのときは、誰の番かが分かる', () => {
    expect(completeFailureMessage('review_pending')).toContain('社内の承認')
  })

  it('分からないときも日本語で伝える', () => {
    const message = completeFailureMessage('unknown')
    expect(message).toContain('完了にできませんでした')
  })
})
