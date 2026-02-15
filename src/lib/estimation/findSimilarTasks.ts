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

  const searchTerm = title.trim()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

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

  // For each task, calculate client wait days from PASS_BALL events
  const similarTasks: SimilarTask[] = await Promise.all(
    tasks.map(async (task: { id: string; title: string; actual_hours: number; updated_at: string }) => {
      const clientWaitDays = await calculateClientWaitDays(sb, task.id)
      return {
        id: task.id,
        title: task.title,
        actual_hours: task.actual_hours,
        completed_at: task.updated_at,
        client_wait_days: clientWaitDays,
      }
    })
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
 * Uses PASS_BALL events to determine time periods.
 */
async function calculateClientWaitDays(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string
): Promise<number | null> {
  const { data: events, error } = await supabase
    .from('task_events')
    .select('action, payload, created_at')
    .eq('task_id' as never, taskId as never)
    .in('action' as never, ['PASS_BALL', 'TASK_CREATE'] as never)
    .order('created_at' as never, { ascending: true })

  if (error || !events || events.length === 0) return null

  let totalClientMs = 0
  let clientSince: number | null = null

  for (const event of events) {
    const ts = new Date(event.created_at).getTime()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = event.payload as any

    if (event.action === 'TASK_CREATE') {
      if (payload?.ball === 'client') {
        clientSince = ts
      }
    } else if (event.action === 'PASS_BALL') {
      const newBall = payload?.ball || payload?.new_ball
      if (newBall === 'client' && clientSince === null) {
        clientSince = ts
      } else if (newBall === 'internal' && clientSince !== null) {
        totalClientMs += ts - clientSince
        clientSince = null
      }
    }
  }

  // If still on client side, count up to now
  if (clientSince !== null) {
    totalClientMs += Date.now() - clientSince
  }

  if (totalClientMs === 0) return null

  return Math.round((totalClientMs / (1000 * 60 * 60 * 24)) * 10) / 10
}
