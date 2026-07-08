import { describe, it, expect } from 'vitest'
import {
  computeAvailableSlots,
  dayLabel,
  formatSlotLabel,
  type BusyPeriod,
} from './computeAvailableSlots'

describe('computeAvailableSlots', () => {
  describe('guard validation', () => {
    it('returns [] when durationMinutes is zero or negative', () => {
      expect(
        computeAvailableSlots([], { startDate: '2026-07-06', endDate: '2026-07-06', durationMinutes: 0 })
      ).toEqual([])
      expect(
        computeAvailableSlots([], { startDate: '2026-07-06', endDate: '2026-07-06', durationMinutes: -30 })
      ).toEqual([])
    })

    it('returns [] when stepMinutes is zero or negative', () => {
      expect(
        computeAvailableSlots([], {
          startDate: '2026-07-06',
          endDate: '2026-07-06',
          durationMinutes: 30,
          stepMinutes: 0,
        })
      ).toEqual([])
    })

    it('returns [] when maxResults is zero or negative', () => {
      expect(
        computeAvailableSlots([], {
          startDate: '2026-07-06',
          endDate: '2026-07-06',
          durationMinutes: 30,
          maxResults: 0,
        })
      ).toEqual([])
    })

    it('returns [] when businessHourStart >= businessHourEnd', () => {
      expect(
        computeAvailableSlots([], {
          startDate: '2026-07-06',
          endDate: '2026-07-06',
          durationMinutes: 30,
          businessHourStart: 18,
          businessHourEnd: 9,
        })
      ).toEqual([])
    })

    it('returns [] for an unparseable startDate/endDate', () => {
      expect(
        computeAvailableSlots([], { startDate: 'not-a-date', endDate: '2026-07-06', durationMinutes: 30 })
      ).toEqual([])
      expect(
        computeAvailableSlots([], { startDate: '2026-07-06', endDate: 'not-a-date', durationMinutes: 30 })
      ).toEqual([])
    })

    it('returns [] for a date string that does not split into exactly 3 "-"-separated parts', () => {
      expect(
        computeAvailableSlots([], { startDate: '2026-07', endDate: '2026-07-06', durationMinutes: 30 })
      ).toEqual([])
    })

    it('returns [] when startDate is after endDate', () => {
      expect(
        computeAvailableSlots([], { startDate: '2026-07-10', endDate: '2026-07-06', durationMinutes: 30 })
      ).toEqual([])
    })
  })

  describe('weekday filtering', () => {
    it('only produces slots on Mon-Fri, skipping Sat/Sun, across a full week', () => {
      // 2026-07-06 = Mon ... 2026-07-12 = Sun
      const slots = computeAvailableSlots([], {
        startDate: '2026-07-06',
        endDate: '2026-07-12',
        durationMinutes: 540, // exactly one 9h business day (9-18)
        stepMinutes: 540,
      })

      expect(slots).toHaveLength(5)
      expect(slots.map((s) => s.dateKey)).toEqual([
        '2026-07-06',
        '2026-07-07',
        '2026-07-08',
        '2026-07-09',
        '2026-07-10',
      ])
      expect(slots.map((s) => s.dayOfWeek)).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('busy period overlap', () => {
    it('excludes a slot that is fully covered by a busy period', () => {
      const busy: BusyPeriod[] = [
        { start: '2026-07-06T10:00:00', end: '2026-07-06T11:00:00' },
      ]
      const slots = computeAvailableSlots(busy, {
        startDate: '2026-07-06',
        endDate: '2026-07-06',
        durationMinutes: 60,
        stepMinutes: 60,
      })

      const starts = slots.map((s) => s.startAt)
      expect(starts).not.toContain('2026-07-06T10:00')
      expect(starts).toContain('2026-07-06T09:00')
      expect(starts).toContain('2026-07-06T11:00')
      expect(slots).toHaveLength(8) // 9 hourly slots (9-18) minus the busy one
    })

    it('excludes every slot that partially overlaps a busy period', () => {
      const busy: BusyPeriod[] = [
        { start: '2026-07-06T09:30:00', end: '2026-07-06T10:30:00' },
      ]
      const slots = computeAvailableSlots(busy, {
        startDate: '2026-07-06',
        endDate: '2026-07-06',
        durationMinutes: 60,
        stepMinutes: 60,
      })

      const starts = slots.map((s) => s.startAt)
      // 09:00-10:00 overlaps (09:30 < 10:00), 10:00-11:00 overlaps (10:30 > 10:00)
      expect(starts).not.toContain('2026-07-06T09:00')
      expect(starts).not.toContain('2026-07-06T10:00')
      expect(starts).toContain('2026-07-06T11:00')
    })

    it('does not let a busy period on one day affect slots on another day', () => {
      const busy: BusyPeriod[] = [
        { start: '2026-07-06T09:00:00', end: '2026-07-06T18:00:00' }, // blocks all of Monday
      ]
      const slots = computeAvailableSlots(busy, {
        startDate: '2026-07-06',
        endDate: '2026-07-07',
        durationMinutes: 60,
        stepMinutes: 60,
      })

      expect(slots.every((s) => s.dateKey === '2026-07-07')).toBe(true)
      expect(slots.length).toBeGreaterThan(0)
    })

    it('treats multiple overlapping busy periods (e.g. from different participants) as a union', () => {
      const busy: BusyPeriod[] = [
        { start: '2026-07-06T09:00:00', end: '2026-07-06T10:00:00' }, // participant A
        { start: '2026-07-06T13:00:00', end: '2026-07-06T14:00:00' }, // participant B
      ]
      const slots = computeAvailableSlots(busy, {
        startDate: '2026-07-06',
        endDate: '2026-07-06',
        durationMinutes: 60,
        stepMinutes: 60,
      })

      const starts = slots.map((s) => s.startAt)
      expect(starts).not.toContain('2026-07-06T09:00')
      expect(starts).not.toContain('2026-07-06T13:00')
      expect(starts).toContain('2026-07-06T11:00')
    })

    it('ignores busy periods with unparseable dates instead of crashing', () => {
      const busy: BusyPeriod[] = [{ start: 'garbage', end: 'also-garbage' }]
      const slots = computeAvailableSlots(busy, {
        startDate: '2026-07-06',
        endDate: '2026-07-06',
        durationMinutes: 540,
        stepMinutes: 540,
      })

      expect(slots).toHaveLength(1)
    })
  })

  describe('options', () => {
    it('respects custom business hours and stepMinutes', () => {
      const slots = computeAvailableSlots([], {
        startDate: '2026-07-06',
        endDate: '2026-07-06',
        durationMinutes: 60,
        businessHourStart: 13,
        businessHourEnd: 15,
        stepMinutes: 60,
      })

      expect(slots.map((s) => s.startAt)).toEqual(['2026-07-06T13:00', '2026-07-06T14:00'])
    })

    it('caps the total number of results at maxResults across multiple days', () => {
      const slots = computeAvailableSlots([], {
        startDate: '2026-07-06',
        endDate: '2026-07-10',
        durationMinutes: 60,
        stepMinutes: 60,
        maxResults: 3,
      })

      expect(slots).toHaveLength(3)
    })

    it('produces correctly formatted startAt/endAt/dayOfWeek/dateKey fields', () => {
      const slots = computeAvailableSlots([], {
        startDate: '2026-07-06',
        endDate: '2026-07-06',
        durationMinutes: 30,
        stepMinutes: 30,
        maxResults: 1,
      })

      expect(slots).toEqual([
        {
          startAt: '2026-07-06T09:00',
          endAt: '2026-07-06T09:30',
          dayOfWeek: 1,
          dateKey: '2026-07-06',
        },
      ])
    })
  })
})

describe('dayLabel', () => {
  it('maps 0-6 to Japanese weekday labels', () => {
    expect(['日', '月', '火', '水', '木', '金', '土'].map((_, i) => dayLabel(i))).toEqual([
      '日',
      '月',
      '火',
      '水',
      '木',
      '金',
      '土',
    ])
  })

  it('returns an empty string for an out-of-range value', () => {
    expect(dayLabel(-1)).toBe('')
    expect(dayLabel(7)).toBe('')
  })
})

describe('formatSlotLabel', () => {
  it('formats a datetime-local range into Japanese human-readable text', () => {
    expect(formatSlotLabel('2026-07-06T10:00', '2026-07-06T11:00')).toBe('7/6(月) 10:00〜11:00')
  })

  it('zero-pads single-digit hours and minutes', () => {
    expect(formatSlotLabel('2026-07-06T09:05', '2026-07-06T09:35')).toBe('7/6(月) 09:05〜09:35')
  })
})
