/**
 * Burndown Chart Computation Logic
 *
 * Computes daily burndown snapshots from audit_logs.
 * See docs/spec/BURNDOWN_SPEC.md for full algorithm specification.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ───────────────────────────────────────────────────────────

export interface BurndownData {
  milestoneId: string
  milestoneName: string
  startDate: string          // YYYY-MM-DD
  endDate: string            // YYYY-MM-DD (due_date)
  totalTasks: number         // MS所属タスク総数 at start
  dataAvailableFrom: string | null
  dailySnapshots: DailySnapshot[]
}

export interface DailySnapshot {
  date: string               // YYYY-MM-DD
  remaining: number          // non-done tasks in MS
  completed: number          // cumulative completed
  added: number              // tasks added this day
  reopened: number           // done → non-done this day
}

interface AuditLogRow {
  id: string
  event_type: string
  target_id: string
  data_before: Record<string, unknown> | null
  data_after: Record<string, unknown> | null
  occurred_at: string
}

interface TaskRow {
  id: string
  status: string
  milestone_id: string | null
}

interface MilestoneRow {
  id: string
  name: string
  start_date: string | null
  due_date: string | null
  created_at: string
}

// Canonical event types for burndown
const BURNDOWN_EVENT_TYPES = [
  'task.status_changed',
  'task.created',
  'task.updated',
  'task.deleted',
] as const

// ─── Date Utilities ──────────────────────────────────────────────────

/**
 * Convert timestamptz to JST date string (YYYY-MM-DD).
 * JST = UTC+9
 */
export function toJSTDateString(timestamptz: string): string {
  const date = new Date(timestamptz)
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const y = jstDate.getUTCFullYear()
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jstDate.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Get today's date in JST as YYYY-MM-DD.
 * Uses manual UTC+9 offset to avoid toISOString().
 */
function todayJST(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Get the next day as YYYY-MM-DD.
 */
function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 1)
  const ny = date.getFullYear()
  const nm = String(date.getMonth() + 1).padStart(2, '0')
  const nd = String(date.getDate()).padStart(2, '0')
  return `${ny}-${nm}-${nd}`
}

// ─── State Builder ───────────────────────────────────────────────────

interface TaskState {
  inMilestone: boolean
  status: string
}

/**
 * Build the state of all tasks at the end of the day BEFORE targetDate.
 *
 * Boundary rule (prevents double-application):
 *   - This function processes events where toJSTDateString(occurred_at) < targetDate
 *   - Events on targetDate itself are handled by the daily loop (periodLogs)
 */
export function buildStateAtDate(
  allTasks: TaskRow[],
  allAuditLogs: AuditLogRow[],
  milestoneId: string | null,
  targetDate: string
): Map<string, TaskState> {
  const isProjectWide = milestoneId === null

  // Initialize with current state as fallback
  const stateMap = new Map<string, TaskState>()
  for (const task of allTasks) {
    stateMap.set(task.id, {
      inMilestone: isProjectWide ? true : task.milestone_id === milestoneId,
      status: task.status,
    })
  }

  // Filter logs before targetDate for state reconstruction
  const preLogs = allAuditLogs.filter(
    (e) => toJSTDateString(e.occurred_at) < targetDate
  )

  // Identify tasks that have ANY audit logs (including post-targetDate).
  // These tasks should NOT use current state as fallback — they'll be
  // reconstructed from logs. Only tasks with ZERO logs keep current state.
  const tasksWithAnyLogs = new Set(allAuditLogs.map((e) => e.target_id))
  for (const taskId of tasksWithAnyLogs) {
    // Reset to neutral state; preLogs will rebuild, and tasks with only
    // post-startDate logs will correctly start as "not in milestone"
    stateMap.set(taskId, { inMilestone: false, status: 'backlog' })
  }

  if (preLogs.length === 0) return stateMap

  // Apply pre-targetDate events in chronological order
  for (const event of preLogs) {
    const taskId = event.target_id

    switch (event.event_type) {
      case 'task.created': {
        const status = (event.data_after?.status as string) || 'backlog'
        if (isProjectWide) {
          // Project-wide: all created tasks belong
          stateMap.set(taskId, { inMilestone: true, status })
        } else {
          const msId = event.data_after?.milestone_id as string | null
          stateMap.set(taskId, {
            inMilestone: msId === milestoneId,
            status,
          })
        }
        break
      }

      case 'task.updated': {
        if (isProjectWide) {
          // Project-wide: milestone reassignment doesn't affect membership
          break
        }
        const toMs = event.data_after?.milestone_id as string | null | undefined
        const fromMs = event.data_before?.milestone_id as string | null | undefined
        const current = stateMap.get(taskId)
        if (current && toMs !== undefined) {
          // Milestone reassignment
          if (toMs === milestoneId) {
            current.inMilestone = true
          } else if (fromMs === milestoneId) {
            current.inMilestone = false
          }
        }
        break
      }

      case 'task.status_changed': {
        const newStatus = event.data_after?.status as string
        const current = stateMap.get(taskId)
        if (current && newStatus) {
          current.status = newStatus
        }
        break
      }

      case 'task.deleted': {
        const current = stateMap.get(taskId)
        if (current) {
          current.inMilestone = false
        }
        break
      }
    }
  }

  return stateMap
}

// ─── Data Fetchers ───────────────────────────────────────────────────

async function getMilestone(
  supabase: SupabaseClient,
  milestoneId: string,
  spaceId: string
): Promise<MilestoneRow> {
   
  const { data, error } = await (supabase as SupabaseClient)
    .from('milestones')
    .select('id, name, start_date, due_date, created_at')
    .eq('id', milestoneId)
    .eq('space_id', spaceId)
    .single()

  if (error) throw new Error(`Milestone not found: ${error.message}`)
  return data as MilestoneRow
}

async function getTasksByMilestone(
  supabase: SupabaseClient,
  spaceId: string,
  milestoneId: string
): Promise<TaskRow[]> {
   
  const { data, error } = await (supabase as SupabaseClient)
    .from('tasks')
    .select('id, status, milestone_id')
    .eq('space_id', spaceId)
    .eq('milestone_id', milestoneId)

  if (error) throw new Error(`Failed to fetch tasks: ${error.message}`)
  return (data || []) as TaskRow[]
}

async function getHistoricalMilestoneTaskIds(
  supabase: SupabaseClient,
  spaceId: string,
  milestoneId: string
): Promise<string[]> {
  // Find task IDs that were historically associated with this milestone
  // by searching audit_logs for ALL relevant event types (not just task.updated)
   
  const { data, error } = await (supabase as SupabaseClient)
    .from('audit_logs')
    .select('target_id')
    .eq('space_id', spaceId)
    .eq('target_type', 'task')
    .in('event_type', BURNDOWN_EVENT_TYPES as unknown as string[])
    .or(
      `data_before->>milestone_id.eq.${milestoneId},data_after->>milestone_id.eq.${milestoneId}`
    )

  if (error) return []

  const ids = new Set<string>()
  for (const row of data || []) {
    ids.add(row.target_id)
  }
  return [...ids]
}

async function getTasksByIds(
  supabase: SupabaseClient,
  taskIds: string[]
): Promise<TaskRow[]> {
  if (taskIds.length === 0) return []

   
  const { data, error } = await (supabase as SupabaseClient)
    .from('tasks')
    .select('id, status, milestone_id')
    .in('id', taskIds)

  if (error) return []
  return (data || []) as TaskRow[]
}

async function getHistoricalSpaceTaskIds(
  supabase: SupabaseClient,
  spaceId: string
): Promise<string[]> {
  // Find all task IDs that have burndown-relevant audit logs in this space
  // (includes hard-deleted tasks no longer in the tasks table)
  const { data, error } = await (supabase as SupabaseClient)
    .from('audit_logs')
    .select('target_id')
    .eq('space_id', spaceId)
    .eq('target_type', 'task')
    .in('event_type', BURNDOWN_EVENT_TYPES as unknown as string[])

  if (error) return []

  const ids = new Set<string>()
  for (const row of data || []) {
    ids.add(row.target_id)
  }
  return [...ids]
}

async function getAllSpaceTasks(
  supabase: SupabaseClient,
  spaceId: string
): Promise<TaskRow[]> {

  const { data, error } = await (supabase as SupabaseClient)
    .from('tasks')
    .select('id, status, milestone_id')
    .eq('space_id', spaceId)

  if (error) throw new Error(`Failed to fetch tasks: ${error.message}`)
  return (data || []) as TaskRow[]
}

async function getAllMilestones(
  supabase: SupabaseClient,
  spaceId: string
): Promise<MilestoneRow[]> {

  const { data, error } = await (supabase as SupabaseClient)
    .from('milestones')
    .select('id, name, start_date, due_date, created_at')
    .eq('space_id', spaceId)

  if (error) throw new Error(`Failed to fetch milestones: ${error.message}`)
  return (data || []) as MilestoneRow[]
}

async function getAuditLogs(
  supabase: SupabaseClient,
  spaceId: string,
  taskIds: string[]
): Promise<AuditLogRow[]> {
  if (taskIds.length === 0) return []

   
  const { data, error } = await (supabase as SupabaseClient)
    .from('audit_logs')
    .select('id, event_type, target_id, data_before, data_after, occurred_at')
    .eq('space_id', spaceId)
    .eq('target_type', 'task')
    .in('event_type', BURNDOWN_EVENT_TYPES as unknown as string[])
    .in('target_id', taskIds)
    .order('occurred_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch audit logs: ${error.message}`)
  return (data || []) as AuditLogRow[]
}

// ─── Main Computation ────────────────────────────────────────────────

export async function computeBurndown(
  supabase: SupabaseClient,
  spaceId: string,
  milestoneId: string | null
): Promise<BurndownData> {
  const isProjectWide = milestoneId === null

  let startDate: string | null = null
  let endDate: string | null = null
  let milestoneName: string
  let allTasks: TaskRow[]
  let allAuditLogs: AuditLogRow[]

  if (isProjectWide) {
    // ── Project-wide mode ──
    const milestones = await getAllMilestones(supabase, spaceId)

    // Compute min(start_date) and max(due_date) from all milestones
    for (const ms of milestones) {
      if (ms.start_date && (!startDate || ms.start_date < startDate)) {
        startDate = ms.start_date
      }
      if (ms.due_date && (!endDate || ms.due_date > endDate)) {
        endDate = ms.due_date
      }
    }

    if (!startDate && !endDate) {
      throw new Error('マイルストーンに開始日または期限を設定してください')
    }

    if (!startDate) {
      // Fallback: earliest milestone created_at
      let earliest: string | null = null
      for (const ms of milestones) {
        const d = toJSTDateString(ms.created_at)
        if (!earliest || d < earliest) earliest = d
      }
      startDate = earliest!
    }

    if (!endDate) {
      // Fallback: today + 14 days
      const future = new Date()
      future.setDate(future.getDate() + 14)
      const y = future.getFullYear()
      const m = String(future.getMonth() + 1).padStart(2, '0')
      const d = String(future.getDate()).padStart(2, '0')
      endDate = `${y}-${m}-${d}`
    }

    milestoneName = 'プロジェクト全体'
    allTasks = await getAllSpaceTasks(supabase, spaceId)
    const currentTaskIds = allTasks.map((t) => t.id)

    // Also collect historical task IDs from audit_logs (includes hard-deleted tasks)
    const historicalIds = await getHistoricalSpaceTaskIds(supabase, spaceId)
    const allTaskIds = [...new Set([...currentTaskIds, ...historicalIds])]

    // Fetch task info for historical-only tasks (not in current tasks table)
    const missingIds = historicalIds.filter((id) => !currentTaskIds.includes(id))
    if (missingIds.length > 0) {
      const missingTasks = await getTasksByIds(supabase, missingIds)
      allTasks = [...allTasks, ...missingTasks]
    }

    allAuditLogs = await getAuditLogs(supabase, spaceId, allTaskIds)
  } else {
    // ── Single milestone mode (existing logic) ──
    const milestone = await getMilestone(supabase, milestoneId, spaceId)

    startDate = milestone.start_date
    endDate = milestone.due_date

    if (!startDate && !endDate) {
      throw new Error('開始日と期限を設定してください')
    }

    if (!startDate) {
      startDate = toJSTDateString(milestone.created_at)
    }

    if (!endDate) {
      const future = new Date()
      future.setDate(future.getDate() + 14)
      const y = future.getFullYear()
      const m = String(future.getMonth() + 1).padStart(2, '0')
      const d = String(future.getDate()).padStart(2, '0')
      endDate = `${y}-${m}-${d}`
    }

    milestoneName = milestone.name

    const currentTasks = await getTasksByMilestone(supabase, spaceId, milestoneId)
    const historicalIds = await getHistoricalMilestoneTaskIds(supabase, spaceId, milestoneId)
    const currentIds = currentTasks.map((t) => t.id)
    const allTaskIds = [...new Set([...currentIds, ...historicalIds])]
    allTasks = await getTasksByIds(supabase, allTaskIds)
    allAuditLogs = await getAuditLogs(supabase, spaceId, allTaskIds)
  }

  // 5. Build initial state at start_date
  const initialState = buildStateAtDate(allTasks, allAuditLogs, milestoneId, startDate)

  const membershipSet = new Set<string>()
  const statusMap = new Map<string, string>()

  for (const [taskId, state] of initialState) {
    statusMap.set(taskId, state.status)
    if (state.inMilestone) {
      membershipSet.add(taskId)
    }
  }

  let remaining = [...membershipSet].filter((id) => statusMap.get(id) !== 'done').length
  const totalTasks = membershipSet.size
  let totalCompleted = [...membershipSet].filter((id) => statusMap.get(id) === 'done').length

  // 6. Pre-bucket period logs by JST date for O(logs) instead of O(days*logs)
  const eventsByDate = new Map<string, AuditLogRow[]>()
  for (const event of allAuditLogs) {
    const eventDate = toJSTDateString(event.occurred_at)
    if (eventDate < startDate!) continue
    const bucket = eventsByDate.get(eventDate)
    if (bucket) {
      bucket.push(event)
    } else {
      eventsByDate.set(eventDate, [event])
    }
  }

  // 7. Daily aggregation
  const snapshots: DailySnapshot[] = []
  let currentDate = startDate
  const today = todayJST()
  const effectiveEnd = endDate < today ? endDate : today

  while (currentDate <= effectiveEnd) {
    const dayEvents = eventsByDate.get(currentDate) || []

    let completedToday = 0
    let reopenedToday = 0
    let addedToday = 0

    for (const event of dayEvents) {
      const taskId = event.target_id

      switch (event.event_type) {
        case 'task.status_changed': {
          const oldStatus = event.data_before?.status as string | undefined
          const newStatus = event.data_after?.status as string | undefined

          // Always update statusMap (tracks MS-external changes too)
          if (newStatus) statusMap.set(taskId, newStatus)

          // Only affect remaining for MS members
          if (!membershipSet.has(taskId)) break

          if (newStatus === 'done' && oldStatus !== 'done') {
            completedToday++
          }
          if (oldStatus === 'done' && newStatus !== 'done') {
            reopenedToday++
          }
          break
        }

        case 'task.created': {
          if (isProjectWide) {
            // Project-wide: all created tasks belong
            membershipSet.add(taskId)
            const taskStatus = (event.data_after?.status as string) || 'backlog'
            statusMap.set(taskId, taskStatus)
            if (taskStatus !== 'done') {
              addedToday++
            }
          } else {
            const msId = event.data_after?.milestone_id as string | null
            if (msId === milestoneId) {
              membershipSet.add(taskId)
              const taskStatus = (event.data_after?.status as string) || 'backlog'
              statusMap.set(taskId, taskStatus)
              if (taskStatus !== 'done') {
                addedToday++
              }
            }
          }
          break
        }

        case 'task.updated': {
          if (isProjectWide) {
            // Project-wide: milestone reassignment doesn't affect membership
            break
          }
          const fromMs = event.data_before?.milestone_id as string | null | undefined
          const toMs = event.data_after?.milestone_id as string | null | undefined

          // MS IN
          if (toMs === milestoneId && fromMs !== milestoneId) {
            membershipSet.add(taskId)
            const currentStatus = statusMap.get(taskId) || 'backlog'
            if (currentStatus !== 'done') {
              addedToday++
            }
          }

          // MS OUT
          if (fromMs === milestoneId && toMs !== milestoneId) {
            const wasRemaining = statusMap.get(taskId) !== 'done'
            membershipSet.delete(taskId)
            if (wasRemaining) {
              remaining--
            }
          }
          break
        }

        case 'task.deleted': {
          if (membershipSet.has(taskId)) {
            const wasRemaining = statusMap.get(taskId) !== 'done'
            membershipSet.delete(taskId)
            if (wasRemaining) {
              remaining--
            }
          }
          break
        }
      }
    }

    remaining = remaining - completedToday + reopenedToday + addedToday
    totalCompleted += completedToday - reopenedToday

    snapshots.push({
      date: currentDate,
      remaining: Math.max(0, remaining),
      completed: Math.max(0, totalCompleted),
      added: addedToday,
      reopened: reopenedToday,
    })

    currentDate = nextDay(currentDate)
  }

  // 8. Data availability date
  const dataAvailableFrom =
    allAuditLogs.length > 0 ? toJSTDateString(allAuditLogs[0].occurred_at) : null

  return {
    milestoneId: milestoneId || 'all',
    milestoneName,
    startDate,
    endDate,
    totalTasks,
    dataAvailableFrom,
    dailySnapshots: snapshots,
  }
}
