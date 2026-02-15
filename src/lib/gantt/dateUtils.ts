/**
 * Gantt Chart Date Utilities
 */

import type { Task, Milestone } from '@/types/database'

/**
 * Normalize a date to midnight (00:00:00) for consistent day calculations
 */
function normalizeToMidnight(date: Date): Date {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  return normalized
}

/**
 * Convert a date to X coordinate
 * Normalizes both dates to midnight to align with day boundaries
 */
export function dateToX(
  date: Date,
  startDate: Date,
  dayWidth: number
): number {
  const normalizedDate = normalizeToMidnight(date)
  const normalizedStart = normalizeToMidnight(startDate)
  const diffTime = normalizedDate.getTime() - normalizedStart.getTime()
  const diffDays = diffTime / (1000 * 60 * 60 * 24)
  return Math.round(diffDays) * dayWidth
}

/**
 * Convert X coordinate to date
 * Uses floor to snap to the day the cursor is within
 */
export function xToDate(
  x: number,
  startDate: Date,
  dayWidth: number
): Date {
  const days = Math.floor(x / dayWidth)
  const result = new Date(startDate)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Format date as YYYY-MM-DD in local timezone (not UTC)
 * This avoids timezone offset issues with toISOString()
 */
export function formatDateToLocalString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Calculate the display date range from tasks and milestones
 *
 * Default behavior:
 * - Start: 3 days before today (for context)
 * - End: 6 weeks from today or latest due_date + 1 week
 * - Only extends backward if there's a due_date in the past
 */
export function calcDateRange(
  tasks: Task[],
  milestones: Milestone[],
  options: { pastDays?: number; futureDays?: number; padding?: number } = {}
): { start: Date; end: Date } {
  const { pastDays = 3, futureDays = 42, padding = 7 } = options

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Start from today - pastDays
  let minDate = new Date(today)
  minDate.setDate(minDate.getDate() - pastDays)

  // End at today + futureDays (6 weeks default)
  let maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + futureDays)

  // Check task start_date and due_date for extending the range
  tasks.forEach((task) => {
    if (task.start_date) {
      const start = new Date(task.start_date)
      start.setHours(0, 0, 0, 0)
      if (start < minDate) {
        minDate = new Date(start)
        minDate.setDate(minDate.getDate() - padding)
      }
    }
    if (task.due_date) {
      const due = new Date(task.due_date)
      due.setHours(0, 0, 0, 0)
      if (due < minDate) {
        minDate = new Date(due)
        minDate.setDate(minDate.getDate() - padding)
      }
      if (due > maxDate) maxDate = due
    }
  })

  // Check milestone dates (start_date + due_date)
  milestones.forEach((milestone) => {
    if (milestone.start_date) {
      const start = new Date(milestone.start_date)
      start.setHours(0, 0, 0, 0)
      if (start < minDate) {
        minDate = new Date(start)
        minDate.setDate(minDate.getDate() - padding)
      }
    }
    if (milestone.due_date) {
      const due = new Date(milestone.due_date)
      due.setHours(0, 0, 0, 0)
      if (due > maxDate) maxDate = due
    }
  })

  // Add padding to end
  const end = new Date(maxDate)
  end.setDate(end.getDate() + padding)

  return { start: minDate, end }
}

/**
 * Get all dates in a range
 */
export function getDatesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = []
  const current = new Date(start)

  while (current <= end) {
    dates.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }

  return dates
}

/**
 * Format date for display
 */
export function formatDateLabel(
  date: Date,
  viewMode: 'day' | 'week' | 'month'
): string {
  const day = date.getDate()
  const month = date.getMonth() + 1

  switch (viewMode) {
    case 'day':
      return `${day}`
    case 'week':
      return `${day}`
    case 'month':
      return day === 1 ? `${month}/${day}` : `${day}`
    default:
      return `${day}`
  }
}

/**
 * Format month header
 */
export function formatMonthHeader(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const monthNames = [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月'
  ]
  return `${year}年 ${monthNames[month - 1]}`
}

/**
 * Check if date is weekend
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * Check if date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date()
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  )
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getDate() === date2.getDate() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getFullYear() === date2.getFullYear()
  )
}

/**
 * Get the number of days between two dates
 */
export function getDaysDiff(start: Date, end: Date): number {
  const diffTime = end.getTime() - start.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Get task bar dimensions
 */
export function getTaskBarPosition(
  task: Task,
  startDate: Date,
  dayWidth: number
): { x: number; width: number } | null {
  // Prefer start_date, fallback to created_at
  const taskStartStr = task.start_date || task.created_at
  const taskStart = taskStartStr ? new Date(taskStartStr) : null
  const taskEnd = task.due_date ? new Date(task.due_date) : null

  // If no dates, return null (won't render bar)
  if (!taskStart && !taskEnd) {
    return null
  }

  // If only start date, show a point
  if (taskStart && !taskEnd) {
    const x = dateToX(taskStart, startDate, dayWidth)
    return { x, width: Math.max(dayWidth, 4) }
  }

  // If only end date, show from start of range to end date
  if (!taskStart && taskEnd) {
    const x = 0
    const endX = dateToX(taskEnd, startDate, dayWidth)
    return { x, width: Math.max(endX - x, 4) }
  }

  // Both dates available
  if (taskStart && taskEnd) {
    const x = dateToX(taskStart, startDate, dayWidth)
    const endX = dateToX(taskEnd, startDate, dayWidth)
    return { x, width: Math.max(endX - x, 4) }
  }

  return null
}
