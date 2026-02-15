/**
 * Gantt Chart Tree Utilities
 * Builds parent-child hierarchy for tasks (1-level only)
 */

import type { Task } from '@/types/database'

export interface TaskTreeNode {
  task: Task
  children: Task[]
  /** Auto-computed date range from children (for summary bar) */
  summaryStart: string | null
  summaryEnd: string | null
}

/**
 * Build a flat ordered list for Gantt display from parent-child relationships.
 * Parent tasks come first, followed by their children.
 * Tasks without a parent are treated as top-level.
 * Child tasks that reference a parent not in the list are treated as top-level.
 */
export function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const taskMap = new Map<string, Task>()
  const childrenMap = new Map<string, Task[]>()

  // Index all tasks
  tasks.forEach((t) => {
    taskMap.set(t.id, t)
  })

  // Group children by parent
  tasks.forEach((t) => {
    if (t.parent_task_id && taskMap.has(t.parent_task_id)) {
      const siblings = childrenMap.get(t.parent_task_id) || []
      siblings.push(t)
      childrenMap.set(t.parent_task_id, siblings)
    }
  })

  const result: TaskTreeNode[] = []
  const processedIds = new Set<string>()

  // Process tasks in order: top-level first, then their children
  tasks.forEach((t) => {
    if (processedIds.has(t.id)) return

    // Skip children (they'll be added under their parent)
    if (t.parent_task_id && taskMap.has(t.parent_task_id)) return

    const children = childrenMap.get(t.id) || []

    // Compute summary dates from children
    const { summaryStart, summaryEnd } = computeSummaryDates(t, children)

    result.push({
      task: t,
      children,
      summaryStart,
      summaryEnd,
    })
    processedIds.add(t.id)

    // Add children as separate nodes (leaf nodes, no grandchildren)
    children.forEach((child) => {
      result.push({
        task: child,
        children: [],
        summaryStart: null,
        summaryEnd: null,
      })
      processedIds.add(child.id)
    })
  })

  return result
}

/**
 * Compute the summary date range for a parent task from its children.
 * Returns the min start_date and max due_date across all children.
 * If the parent has its own dates and no children, uses the parent's dates.
 */
function computeSummaryDates(
  parent: Task,
  children: Task[]
): { summaryStart: string | null; summaryEnd: string | null } {
  if (children.length === 0) {
    return { summaryStart: null, summaryEnd: null }
  }

  let minStart: string | null = null
  let maxEnd: string | null = null

  // Include parent's own dates if set
  if (parent.start_date) minStart = parent.start_date
  if (parent.due_date) maxEnd = parent.due_date

  children.forEach((child) => {
    const childStart = child.start_date
    const childEnd = child.due_date

    if (childStart) {
      if (!minStart || childStart < minStart) minStart = childStart
    }
    if (childEnd) {
      if (!maxEnd || childEnd > maxEnd) maxEnd = childEnd
    }
  })

  return { summaryStart: minStart, summaryEnd: maxEnd }
}

/**
 * Check if a task is a parent (has children in the current task list)
 */
export function isParentTask(taskId: string, tasks: Task[]): boolean {
  return tasks.some((t) => t.parent_task_id === taskId)
}

/**
 * Get eligible parent tasks (tasks that don't have a parent themselves)
 * This enforces the 1-level hierarchy constraint.
 */
export function getEligibleParents(tasks: Task[], excludeTaskId?: string): Task[] {
  return tasks.filter(
    (t) => !t.parent_task_id && t.id !== excludeTaskId
  )
}
