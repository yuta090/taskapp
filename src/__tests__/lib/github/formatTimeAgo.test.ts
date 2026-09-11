import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatTimeAgo } from '@/lib/github/formatTimeAgo'

describe('formatTimeAgo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('1分未満は「たった今」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T10:00:30.000Z'))
    expect(formatTimeAgo('2026-09-11T10:00:00.000Z')).toBe('たった今')
  })

  it('分単位は「N分前」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T10:05:00.000Z'))
    expect(formatTimeAgo('2026-09-11T10:00:00.000Z')).toBe('5分前')
  })

  it('時間単位は「N時間前」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T13:00:00.000Z'))
    expect(formatTimeAgo('2026-09-11T10:00:00.000Z')).toBe('3時間前')
  })

  it('日単位は「N日前」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T10:00:00.000Z'))
    expect(formatTimeAgo('2026-09-11T10:00:00.000Z')).toBe('3日前')
  })
})
