import { describe, expect, it } from 'vitest'
import { formatNoteStamp, formatNoteStampLabel } from '@/lib/minutes/noteStamp'

describe('会議メモに残す日時', () => {
  it('日本の時刻の年月日と時分を、そのままの形で持つ', () => {
    // jstNow() が返す Date は「ローカルの getter が日本時間を返す」形
    const jst = new Date(2026, 8, 15, 14, 30, 0)
    expect(formatNoteStamp(jst)).toBe('2026-09-15T14:30')
  })

  it('1桁の月日・時分も2桁でそろえる', () => {
    expect(formatNoteStamp(new Date(2026, 0, 3, 9, 5, 0))).toBe('2026-01-03T09:05')
  })

  it('本番が UTC でも日本の日付になる', () => {
    // 日本時間 2026-09-15 07:00（＝UTC では前日の 22:00）
    const realMoment = new Date('2026-09-14T22:00:00Z')
    expect(formatNoteStamp(undefined, realMoment)).toBe('2026-09-15T07:00')
  })
})

describe('会議メモの日時の見せ方', () => {
  const today = new Date(2026, 8, 15, 18, 0, 0)

  it('同じ年なら月日と時刻だけ', () => {
    expect(formatNoteStampLabel('2026-09-15T14:30', today)).toBe('9/15 14:30')
  })

  it('年が違えば年も出す', () => {
    expect(formatNoteStampLabel('2025-12-03T09:05', today)).toBe('2025/12/3 9:05')
  })

  it('形が違うものは出さない', () => {
    expect(formatNoteStampLabel('こわれた', today)).toBeNull()
    expect(formatNoteStampLabel('', today)).toBeNull()
    expect(formatNoteStampLabel(undefined, today)).toBeNull()
  })
})
