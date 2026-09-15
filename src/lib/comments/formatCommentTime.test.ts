import { describe, it, expect } from 'vitest'
import { formatCommentTime } from './formatCommentTime'

const NOW = new Date('2026-09-16T12:00:00+09:00')

describe('formatCommentTime — コメントを書いた時刻を「○分前」で出す', () => {
  it('1分未満は「たった今」', () => {
    expect(formatCommentTime('2026-09-16T11:59:30+09:00', NOW)).toBe('たった今')
  })

  it('1時間未満は分で出す', () => {
    expect(formatCommentTime('2026-09-16T11:15:00+09:00', NOW)).toBe('45分前')
  })

  it('1日未満は時間で出す', () => {
    expect(formatCommentTime('2026-09-16T09:00:00+09:00', NOW)).toBe('3時間前')
  })

  it('1週間未満は日で出す', () => {
    expect(formatCommentTime('2026-09-13T12:00:00+09:00', NOW)).toBe('3日前')
  })
})
