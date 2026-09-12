import { describe, it, expect } from 'vitest'
import { meetingStatusLabel, proposalStatusLabel } from './statusLabels.js'

/**
 * 会議・日程調整提案の状態(status)を、呼んだ人に見せてよい日本語のラベルにする。
 * 見覚えのない値（新しい状態が増えた・想定外の値）はそのまま返す（安全側）。
 */

describe('meetingStatusLabel', () => {
  it('planned / in_progress / ended を日本語にする', () => {
    expect(meetingStatusLabel('planned')).toBe('開始前')
    expect(meetingStatusLabel('in_progress')).toBe('進行中')
    expect(meetingStatusLabel('ended')).toBe('終了済み')
  })

  it('見覚えのない値はそのまま返す', () => {
    expect(meetingStatusLabel('unknown_status')).toBe('unknown_status')
  })
})

describe('proposalStatusLabel', () => {
  it('open / confirmed / cancelled / expired を日本語にする', () => {
    expect(proposalStatusLabel('open')).toBe('回答受付中')
    expect(proposalStatusLabel('confirmed')).toBe('確定済み')
    expect(proposalStatusLabel('cancelled')).toBe('キャンセル済み')
    expect(proposalStatusLabel('expired')).toBe('期限切れ')
  })

  it('見覚えのない値はそのまま返す', () => {
    expect(proposalStatusLabel('unknown_status')).toBe('unknown_status')
  })
})
