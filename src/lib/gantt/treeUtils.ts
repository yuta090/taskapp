/**
 * Gantt Chart Tree Utilities
 * Builds parent-child hierarchy for tasks (multi-level, up to 10 deep)
 */

import type { Task } from '@/types/database'

/** Maximum nesting depth — must match DB trigger (check_task_parent_hierarchy) */
export const MAX_HIERARCHY_DEPTH = 10

export interface TaskTreeNode {
  task: Task
  children: TaskTreeNode[]
  depth: number
  /** Auto-computed date range from all descendants (for summary bar) */
  summaryStart: string | null
  summaryEnd: string | null
}

/**
 * Build a flat ordered list for Gantt display from recursive parent-child relationships.
 * Parent tasks come first, followed by their children (depth-first).
 * Tasks without a parent (or whose parent is not in the list) are top-level.
 */
export function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const taskMap = new Map<string, Task>()
  const childrenMap = new Map<string, Task[]>()

  tasks.forEach((t) => taskMap.set(t.id, t))

  tasks.forEach((t) => {
    if (t.parent_task_id && taskMap.has(t.parent_task_id)) {
      const siblings = childrenMap.get(t.parent_task_id) || []
      siblings.push(t)
      childrenMap.set(t.parent_task_id, siblings)
    }
  })

  const result: TaskTreeNode[] = []
  const processedIds = new Set<string>()
  const buildVisited = new Set<string>() // prevent infinite recursion on corrupt data

  function buildNode(task: Task, depth: number): TaskTreeNode {
    buildVisited.add(task.id)
    const children = (childrenMap.get(task.id) || []).filter((c) => !buildVisited.has(c.id))
    const childNodes = children.map((c) => buildNode(c, depth + 1))

    // Compute summary dates from all descendants
    const allDescendants = collectDescendants(task.id, childrenMap)
    const { summaryStart, summaryEnd } = computeSummaryDates(allDescendants)

    return { task, children: childNodes, depth, summaryStart, summaryEnd }
  }

  function flatten(node: TaskTreeNode): void {
    result.push(node)
    processedIds.add(node.task.id)
    node.children.forEach((child) => flatten(child))
  }

  // Process top-level tasks in original order
  tasks.forEach((t) => {
    if (processedIds.has(t.id)) return
    if (t.parent_task_id && taskMap.has(t.parent_task_id)) return
    const node = buildNode(t, 0)
    flatten(node)
  })

  // Rescue pass: tasks in cycles or with corrupt parent refs that weren't processed
  tasks.forEach((t) => {
    if (processedIds.has(t.id)) return
    const node: TaskTreeNode = {
      task: t,
      children: [],
      depth: 0,
      summaryStart: null,
      summaryEnd: null,
    }
    result.push(node)
    processedIds.add(t.id)
  })

  return result
}

/** Collect all descendant tasks recursively (with cycle protection) */
function collectDescendants(
  taskId: string,
  childrenMap: Map<string, Task[]>
): Task[] {
  const result: Task[] = []
  const visited = new Set<string>([taskId])
  const stack = [taskId]
  while (stack.length > 0) {
    const current = stack.pop()!
    const children = childrenMap.get(current) || []
    children.forEach((child) => {
      if (!visited.has(child.id)) {
        visited.add(child.id)
        result.push(child)
        stack.push(child.id)
      }
    })
  }
  return result
}

/**
 * Compute summary date range from a list of descendant tasks.
 * Returns the min start_date and max due_date.
 */
function computeSummaryDates(
  descendants: Task[]
): { summaryStart: string | null; summaryEnd: string | null } {
  if (descendants.length === 0) {
    return { summaryStart: null, summaryEnd: null }
  }

  let minStart: string | null = null
  let maxEnd: string | null = null

  descendants.forEach((t) => {
    if (t.start_date) {
      if (!minStart || t.start_date < minStart) minStart = t.start_date
    }
    if (t.due_date) {
      if (!maxEnd || t.due_date > maxEnd) maxEnd = t.due_date
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
 * Get eligible parent tasks: exclude self and all descendants (to prevent cycles).
 * Any task can be a parent regardless of its own parent status.
 */
export function getEligibleParents(tasks: Task[], excludeTaskId?: string): Task[] {
  if (!excludeTaskId) return tasks
  const descendantIds = getDescendantIds(excludeTaskId, tasks)
  return tasks.filter((t) => t.id !== excludeTaskId && !descendantIds.has(t.id))
}

/**
 * Get all descendant IDs of a task (BFS traversal)
 */
export function getDescendantIds(taskId: string, tasks: Task[]): Set<string> {
  const result = new Set<string>()
  const stack = [taskId]
  while (stack.length > 0) {
    const current = stack.pop()!
    tasks.forEach((t) => {
      if (t.parent_task_id === current && !result.has(t.id)) {
        result.add(t.id)
        stack.push(t.id)
      }
    })
  }
  return result
}

/**
 * Get all ancestor IDs of a task (walk up parent chain)
 */
export function getAncestorIds(taskId: string, tasks: Task[]): Set<string> {
  const result = new Set<string>()
  let currentId: string | null = taskId
  while (currentId) {
    const task = tasks.find((t) => t.id === currentId)
    currentId = task?.parent_task_id ?? null
    if (currentId) {
      if (result.has(currentId)) break // safety: cycle detection
      result.add(currentId)
    }
  }
  return result
}
