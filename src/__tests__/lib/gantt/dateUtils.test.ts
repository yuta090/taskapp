import { describe, it, expect } from 'vitest'
import {
  dateToX,
  xToDate,
  calcDateRange,
  getDatesInRange,
  formatDateLabel,
  formatMonthHeader,
  isWeekend,
  isToday,
  isSameDay,
  getDaysDiff,
  getTaskBarPosition,
} from '@/lib/gantt/dateUtils'
import type { Task, Milestone } from '@/types/database'

describe('dateUtils', () => {
  describe('dateToX', () => {
    it('should convert date to X coordinate', () => {
      const startDate = new Date('2024-01-01')
      const date = new Date('2024-01-05')
      const dayWidth = 40

      const x = dateToX(date, startDate, dayWidth)
      expect(x).toBe(4 * 40) // 4 days * 40px
    })

    it('should return 0 for start date', () => {
      const startDate = new Date('2024-01-01')
      const x = dateToX(startDate, startDate, 40)
      expect(x).toBe(0)
    })

    it('should handle negative values (date before start)', () => {
      const startDate = new Date('2024-01-05')
      const date = new Date('2024-01-01')
      const x = dateToX(date, startDate, 40)
      expect(x).toBe(-4 * 40)
    })
  })

  describe('xToDate', () => {
    it('should convert X coordinate to date', () => {
      const startDate = new Date('2024-01-01')
      const x = 160 // 4 days at 40px/day
      const dayWidth = 40

      const date = xToDate(x, startDate, dayWidth)
      expect(date.getDate()).toBe(5) // Jan 5
    })

    it('should return start date for x=0', () => {
      const startDate = new Date('2024-01-01')
      const date = xToDate(0, startDate, 40)
      expect(isSameDay(date, startDate)).toBe(true)
    })
  })

  describe('calcDateRange', () => {
    it('should return default range for empty tasks', () => {
      const { start, end } = calcDateRange([], [])
      const today = new Date()

      // Should be around today with padding
      expect(start < today).toBe(true)
      expect(end > today).toBe(true)
    })

    it('should include task due_date in range (extends forward)', () => {
      // Create a task with due_date far in the future
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 100)
      const futureDateStr = futureDate.toISOString().split('T')[0]

      const tasks: Task[] = [
        {
          id: '1',
          org_id: 'org',
          space_id: 'space',
          title: 'Test',
          description: null,
          status: 'backlog',
          priority: null,
          assignee_id: null,
          due_date: futureDateStr,
          milestone_id: null,
          ball: 'internal',
          origin: 'internal',
          type: 'task',
          spec_path: null,
          decision_state: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]

      const { end } = calcDateRange(tasks, [])

      // End should be at or after the due_date
      expect(end >= futureDate).toBe(true)
    })

    it('should extend backward only for past due_dates', () => {
      // Create a task with due_date in the past
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 30)
      const pastDateStr = pastDate.toISOString().split('T')[0]

      const tasks: Task[] = [
        {
          id: '1',
          org_id: 'org',
          space_id: 'space',
          title: 'Test',
          description: null,
          status: 'backlog',
          priority: null,
          assignee_id: null,
          due_date: pastDateStr,
          milestone_id: null,
          ball: 'internal',
          origin: 'internal',
          type: 'task',
          spec_path: null,
          decision_state: null,
          created_at: '2020-01-01', // created_at should NOT affect range
          updated_at: '2020-01-01',
        },
      ]

      const { start } = calcDateRange(tasks, [])

      // Start should be before the past due_date (with padding)
      expect(start <= pastDate).toBe(true)
    })

    it('should include milestone dates in range', () => {
      const milestones: Milestone[] = [
        {
          id: '1',
          org_id: 'org',
          space_id: 'space',
          name: 'Release',
          due_date: '2024-12-31',
          order_key: 1,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]

      const { end } = calcDateRange([], milestones)
      expect(end >= new Date('2024-12-31')).toBe(true)
    })
  })

  describe('getDatesInRange', () => {
    it('should return all dates in range', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-01-05')

      const dates = getDatesInRange(start, end)

      expect(dates.length).toBe(5)
      expect(dates[0].getDate()).toBe(1)
      expect(dates[4].getDate()).toBe(5)
    })

    it('should return single date for same start/end', () => {
      const date = new Date('2024-01-01')
      const dates = getDatesInRange(date, date)
      expect(dates.length).toBe(1)
    })
  })

  describe('formatDateLabel', () => {
    it('should format date for day view', () => {
      const date = new Date('2024-01-15')
      expect(formatDateLabel(date, 'day')).toBe('15')
    })

    it('should format date for week view', () => {
      const date = new Date('2024-01-15')
      expect(formatDateLabel(date, 'week')).toBe('15')
    })

    it('should format first of month differently', () => {
      const date = new Date('2024-02-01')
      expect(formatDateLabel(date, 'month')).toBe('2/1')
    })
  })

  describe('formatMonthHeader', () => {
    it('should format month header', () => {
      const date = new Date('2024-03-15')
      expect(formatMonthHeader(date)).toBe('2024年 3月')
    })
  })

  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      const saturday = new Date('2024-01-06') // Saturday
      expect(isWeekend(saturday)).toBe(true)
    })

    it('should return true for Sunday', () => {
      const sunday = new Date('2024-01-07') // Sunday
      expect(isWeekend(sunday)).toBe(true)
    })

    it('should return false for weekday', () => {
      const monday = new Date('2024-01-08') // Monday
      expect(isWeekend(monday)).toBe(false)
    })
  })

  describe('isToday', () => {
    it('should return true for today', () => {
      const today = new Date()
      expect(isToday(today)).toBe(true)
    })

    it('should return false for other dates', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      expect(isToday(yesterday)).toBe(false)
    })
  })

  describe('isSameDay', () => {
    it('should return true for same day', () => {
      const date1 = new Date('2024-01-15T10:00:00')
      const date2 = new Date('2024-01-15T20:00:00')
      expect(isSameDay(date1, date2)).toBe(true)
    })

    it('should return false for different days', () => {
      const date1 = new Date('2024-01-15')
      const date2 = new Date('2024-01-16')
      expect(isSameDay(date1, date2)).toBe(false)
    })
  })

  describe('getDaysDiff', () => {
    it('should return correct number of days', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-01-10')
      expect(getDaysDiff(start, end)).toBe(9)
    })

    it('should return 0 for same day', () => {
      const date = new Date('2024-01-01')
      expect(getDaysDiff(date, date)).toBe(0)
    })
  })

  describe('getTaskBarPosition', () => {
    const startDate = new Date('2024-01-01')
    const dayWidth = 40

    it('should return null for task without dates', () => {
      const task: Task = {
        id: '1',
        org_id: 'org',
        space_id: 'space',
        title: 'Test',
        description: null,
        status: 'backlog',
        priority: null,
        assignee_id: null,
        due_date: null,
        milestone_id: null,
        ball: 'internal',
        origin: 'internal',
        type: 'task',
        spec_path: null,
        decision_state: null,
        created_at: '',
        updated_at: '',
      }

      const position = getTaskBarPosition(task, startDate, dayWidth)
      expect(position).toBeNull()
    })

    it('should return position for task with both dates', () => {
      const task: Task = {
        id: '1',
        org_id: 'org',
        space_id: 'space',
        title: 'Test',
        description: null,
        status: 'backlog',
        priority: null,
        assignee_id: null,
        due_date: '2024-01-10',
        milestone_id: null,
        ball: 'internal',
        origin: 'internal',
        type: 'task',
        spec_path: null,
        decision_state: null,
        created_at: '2024-01-05',
        updated_at: '2024-01-05',
      }

      const position = getTaskBarPosition(task, startDate, dayWidth)

      expect(position).not.toBeNull()
      expect(position!.x).toBe(4 * 40) // Jan 5 - Jan 1 = 4 days
      expect(position!.width).toBe(5 * 40) // Jan 10 - Jan 5 = 5 days
    })

    it('should return minimum width for short tasks', () => {
      const task: Task = {
        id: '1',
        org_id: 'org',
        space_id: 'space',
        title: 'Test',
        description: null,
        status: 'backlog',
        priority: null,
        assignee_id: null,
        due_date: '2024-01-05',
        milestone_id: null,
        ball: 'internal',
        origin: 'internal',
        type: 'task',
        spec_path: null,
        decision_state: null,
        created_at: '2024-01-05',
        updated_at: '2024-01-05',
      }

      const position = getTaskBarPosition(task, startDate, dayWidth)

      expect(position).not.toBeNull()
      expect(position!.width).toBeGreaterThanOrEqual(4)
    })
  })
})
