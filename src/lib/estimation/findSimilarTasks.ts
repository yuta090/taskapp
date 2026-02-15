import type { SupabaseClient } from '@supabase/supabase-js'

export interface SimilarTask {
  id: string
  title: string
  actual_hours: number
  completed_at: string
  client_wait_days: number | null
}

export interface EstimationResult {
  similarTasks: SimilarTask[]
  avgHours: number | null
  avgClientWaitDays: number | null
}

/**
 * Escape LIKE/ILIKE wildcard characters in search term.
 * Prevents unintended broad matches from user input containing % or _.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[%_\\]/g, '\\$&')
}

/**
 * Find similar completed tasks with actual_hours recorded.
 * Matches by title substring (supports Japanese).
 * Also calculates client wait days from task_events PASS_BALL history.
 */
export async function findSimilarTasks(
  supabase: SupabaseClient,
  params: {
    title: string
    spaceId: string
    orgId: string
  }
): Promise<EstimationResult> {
  const { title, spaceId, orgId } = params

  if (!title || title.trim().length < 2) {
    return { similarTasks: [], avgHours: null, avgClientWaitDays: null }
  }

  const searchTerm = escapeLikePattern(title.trim())

  const sb = supabase as SupabaseClient

  // Search for completed tasks with actual_hours in the same space
  const { data: tasks, error } = await sb
    .from('tasks')
    .select('id, title, actual_hours, updated_at')
    .eq('space_id' as never, spaceId as never)
    .eq('org_id' as never, orgId as never)
    .eq('status' as never, 'done' as never)
    .not('actual_hours' as never, 'is' as never, null)
    .ilike('title' as never, `%${searchTerm}%` as never)
    .order('updated_at' as never, { ascending: false })
    .limit(10)

  if (error || !tasks || tasks.length === 0) {
    return { similarTasks: [], avgHours: null, avgClientWaitDays: null }
  }

  // Batch fetch: get all task_events for candidate tasks in one query (avoid N+1)
  const taskIds = tasks.map((t: { id: string }) => t.id)
  const { data: allEvents } = await sb
    .from('task_events')
    .select('task_id, action, payload, created_at')
    .in('task_id' as never, taskIds as never)
    .in('action' as never, ['PASS_BALL', 'TASK_CREATE'] as never)
    .order('created_at' as never, { ascending: true })

  // Group events by task_id
  const eventsByTask = new Map<string, Array<{ action: string; payload: Record<string, unknown>; created_at: string }>>()
  if (allEvents) {
    for (const event of allEvents) {
      const existing = eventsByTask.get(event.task_id) || []
      existing.push(event)
      eventsByTask.set(event.task_id, existing)
    }
  }

  // Build similar tasks with client wait days
  const similarTasks: SimilarTask[] = tasks.map(
    (task: { id: string; title: string; actual_hours: number; updated_at: string }) => {
      const events = eventsByTask.get(task.id) || []
      // Pass task's updated_at as completion time to avoid counting beyond completion
      const clientWaitDays = calculateClientWaitDays(events, task.updated_at)
      return {
        id: task.id,
        title: task.title,
        actual_hours: task.actual_hours,
        completed_at: task.updated_at,
        client_wait_days: clientWaitDays,
      }
    }
  )

  // Calculate averages
  const avgHours =
    similarTasks.length > 0
      ? Math.round(
          (similarTasks.reduce((sum, t) => sum + t.actual_hours, 0) / similarTasks.length) * 10
        ) / 10
      : null

  const tasksWithWait = similarTasks.filter((t) => t.client_wait_days !== null)
  const avgClientWaitDays =
    tasksWithWait.length > 0
      ? Math.round(
          (tasksWithWait.reduce((sum, t) => sum + (t.client_wait_days || 0), 0) /
            tasksWithWait.length) *
            10
        ) / 10
      : null

  return {
    similarTasks: similarTasks.slice(0, 5),
    avgHours,
    avgClientWaitDays,
  }
}

/**
 * Calculate total days the ball was on client side for a given task.
 * Uses pre-fetched PASS_BALL events to determine time periods.
 *
 * For completed tasks, uses completedAt as the end boundary instead of Date.now()
 * to prevent client wait days from growing indefinitely after task completion.
 */
function calculateClientWaitDays(
  events: Array<{ action: string; payload: Record<string, unknown>; created_at: string }>,
  completedAt: string
): number | null {
  if (events.length === 0) return null

  const endTime = new Date(completedAt).getTime()
  let totalClientMs = 0
  let clientSince: number | null = null

  for (const event of events) {
    const ts = new Date(event.created_at).getTime()
    const payload = event.payload

    if (event.action === 'TASK_CREATE') {
      if (payload?.ball === 'client') {
        clientSince = ts
      }
    } else if (event.action === 'PASS_BALL') {
      const newBall = (payload?.ball || payload?.new_ball) as string | undefined
      if (newBall === 'client' && clientSince === null) {
        clientSince = ts
      } else if (newBall === 'internal' && clientSince !== null) {
        totalClientMs += ts - clientSince
        clientSince = null
      }
    }
  }

  // If still on client side at completion, count up to completion time (not Date.now())
  if (clientSince !== null) {
    totalClientMs += endTime - clientSince
  }

  if (totalClientMs === 0) return null

  return Math.round((totalClientMs / (1000 * 60 * 60 * 24)) * 10) / 10
}
