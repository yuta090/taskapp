import { describe, expect, it } from 'vitest'
import type { Meeting } from '@/types/database'
import { buildMeetingList, formatMeetingDate, meetingStatusLabel } from './meetingList'

function meeting(over: Partial<Meeting>): Meeting {
  return {
    id: 'm1',
    org_id: 'o1',
    space_id: 's1',
    title: '定例',
    held_at: '2026-10-03T05:00:00Z',
    status: 'planned',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Meeting
}

describe('buildMeetingList', () => {
  it('held_at の新しい順に並べる', () => {
    const list = buildMeetingList([
      meeting({ id: 'a', held_at: '2026-10-01T05:00:00Z' }),
      meeting({ id: 'b', held_at: '2026-10-03T05:00:00Z' }),
      meeting({ id: 'c', held_at: '2026-10-02T05:00:00Z' }),
    ])
    expect(list.map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('held_at が無い会議は created_at で並べる', () => {
    const list = buildMeetingList([
      meeting({ id: 'a', held_at: '2026-10-01T05:00:00Z' }),
      meeting({ id: 'b', held_at: null, created_at: '2026-10-02T00:00:00Z' }),
      meeting({ id: 'c', held_at: null, created_at: '2026-09-20T00:00:00Z' }),
    ])
    expect(list.map((m) => m.id)).toEqual(['b', 'a', 'c'])
  })

  it('同じ時刻なら id の降順で安定させる（Web の一覧と同じ）', () => {
    const list = buildMeetingList([
      meeting({ id: 'a', held_at: '2026-10-03T05:00:00Z' }),
      meeting({ id: 'c', held_at: '2026-10-03T05:00:00Z' }),
      meeting({ id: 'b', held_at: '2026-10-03T05:00:00Z' }),
    ])
    expect(list.map((m) => m.id)).toEqual(['c', 'b', 'a'])
  })

  it('入力の配列を並べ替えない', () => {
    const input = [meeting({ id: 'a', held_at: '2026-10-01T05:00:00Z' }), meeting({ id: 'b', held_at: '2026-10-03T05:00:00Z' })]
    buildMeetingList(input)
    expect(input.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('meetingStatusLabel', () => {
  it('Web の一覧と同じ言葉にする', () => {
    expect(meetingStatusLabel('in_progress')).toBe('進行中')
    expect(meetingStatusLabel('ended')).toBe('終了')
    expect(meetingStatusLabel('planned')).toBe('予定')
  })

  it('知らない状態は予定として出す', () => {
    expect(meetingStatusLabel('unknown' as never)).toBe('予定')
  })
})

describe('formatMeetingDate', () => {
  it('日本時間の「10月3日（土）14:00」にする', () => {
    // 2026-10-03 05:00 UTC = 14:00 JST（土曜）
    expect(formatMeetingDate('2026-10-03T05:00:00Z')).toBe('10月3日（土）14:00')
  })

  it('UTC では前日でも、日本時間の日付で出す', () => {
    // 2026-10-02 20:30 UTC = 10/3 05:30 JST
    expect(formatMeetingDate('2026-10-02T20:30:00Z')).toBe('10月3日（土）05:30')
  })

  it('日本時間の 0:00 のときは日付だけ', () => {
    // 2026-10-02 15:00 UTC = 10/3 00:00 JST
    expect(formatMeetingDate('2026-10-02T15:00:00Z')).toBe('10月3日（土）')
  })

  it('月・日は 0 埋めしない', () => {
    // 2026-01-05 は月曜
    expect(formatMeetingDate('2026-01-05T00:05:00Z')).toBe('1月5日（月）09:05')
  })

  it('日時が無い・読めないときは空文字', () => {
    expect(formatMeetingDate(null)).toBe('')
    expect(formatMeetingDate('')).toBe('')
    expect(formatMeetingDate('not a date')).toBe('')
  })
})
