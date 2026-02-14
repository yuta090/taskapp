/**
 * Risk Forecast Calculator
 *
 * Rule-based risk prediction for milestones.
 * Calculates whether current velocity can complete remaining tasks before deadline.
 */

import type { Task, Milestone } from '@/types/database'

export type RiskLevel = 'high' | 'medium' | 'low' | 'none'

export interface RiskAssessment {
  level: RiskLevel
  ratio: number
  remainingTasks: number
  velocity: number
  clientBlockedTasks: number
  availableDays: number
  requiredDays: number
  allClientBlocked: boolean
  insufficientData: boolean
}

export interface RiskForecastResult {
  /** Map of milestone ID to risk assessment */
  forecasts: Map<string, RiskAssessment>
}

/**
 * Calculate risk assessment for a single milestone.
 *
 * @param milestone - The milestone to assess
 * @param milestoneTasks - Tasks belonging to this milestone
 * @param velocity - Completed tasks per day (over last 14 days)
 */
export function calculateMilestoneRisk(
  milestone: Milestone,
  milestoneTasks: Task[],
  velocity: number
): RiskAssessment {
  const remainingTasks = milestoneTasks.filter((t) => t.status !== 'done')
  const clientBlockedTasks = remainingTasks.filter((t) => t.ball === 'client')

  // All tasks done
  if (remainingTasks.length === 0) {
    return {
      level: 'none',
      ratio: 0,
      remainingTasks: 0,
      velocity,
      clientBlockedTasks: clientBlockedTasks.length,
      availableDays: 0,
      requiredDays: 0,
      allClientBlocked: false,
      insufficientData: false,
    }
  }

  // No due date - cannot assess
  if (!milestone.due_date) {
    return {
      level: 'low',
      ratio: 0,
      remainingTasks: remainingTasks.length,
      velocity,
      clientBlockedTasks: clientBlockedTasks.length,
      availableDays: 0,
      requiredDays: 0,
      allClientBlocked: false,
      insufficientData: true,
    }
  }

  // All remaining tasks are client-blocked
  const allClientBlocked =
    remainingTasks.length > 0 &&
    remainingTasks.every((t) => t.ball === 'client')

  // Calculate available days
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(milestone.due_date)
  dueDate.setHours(0, 0, 0, 0)
  const availableDays = Math.ceil(
    (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )

  // No velocity data (no tasks completed in last 14 days)
  if (velocity === 0) {
    return {
      level: 'high',
      ratio: Infinity,
      remainingTasks: remainingTasks.length,
      velocity: 0,
      clientBlockedTasks: clientBlockedTasks.length,
      availableDays,
      requiredDays: Infinity,
      allClientBlocked,
      insufficientData: true,
    }
  }

  const requiredDays = remainingTasks.length / velocity

  // Deadline already passed
  if (availableDays <= 0) {
    return {
      level: 'high',
      ratio: Infinity,
      remainingTasks: remainingTasks.length,
      velocity,
      clientBlockedTasks: clientBlockedTasks.length,
      availableDays,
      requiredDays,
      allClientBlocked,
      insufficientData: false,
    }
  }

  const ratio = requiredDays / availableDays

  let level: RiskLevel
  if (ratio > 1.5) {
    level = 'high'
  } else if (ratio > 1.0) {
    level = 'medium'
  } else {
    level = 'low'
  }

  return {
    level,
    ratio,
    remainingTasks: remainingTasks.length,
    velocity,
    clientBlockedTasks: clientBlockedTasks.length,
    availableDays,
    requiredDays,
    allClientBlocked,
    insufficientData: false,
  }
}

/**
 * Calculate velocity: completed tasks per day over the last N days.
 *
 * @param tasks - All tasks in the space
 * @param days - Lookback window in days (default: 14)
 * @returns Average tasks completed per day
 */
export function calculateVelocity(tasks: Task[], days: number = 14): number {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days)

  const completedInWindow = tasks.filter((t) => {
    if (t.status !== 'done') return false
    if (!t.updated_at) return false
    const updatedAt = new Date(t.updated_at)
    return updatedAt >= cutoff
  })

  return completedInWindow.length / days
}

/**
 * Calculate risk forecasts for all milestones.
 *
 * @param tasks - All tasks in the space
 * @param milestones - All milestones in the space
 * @returns Map of milestone ID to risk assessment
 */
export function calculateRiskForecasts(
  tasks: Task[],
  milestones: Milestone[]
): Map<string, RiskAssessment> {
  const velocity = calculateVelocity(tasks)
  const forecasts = new Map<string, RiskAssessment>()

  // Group tasks by milestone
  const tasksByMilestone = new Map<string, Task[]>()
  tasks.forEach((task) => {
    if (task.milestone_id) {
      const existing = tasksByMilestone.get(task.milestone_id) || []
      existing.push(task)
      tasksByMilestone.set(task.milestone_id, existing)
    }
  })

  milestones.forEach((milestone) => {
    const milestoneTasks = tasksByMilestone.get(milestone.id) || []
    const assessment = calculateMilestoneRisk(milestone, milestoneTasks, velocity)
    forecasts.set(milestone.id, assessment)
  })

  return forecasts
}
