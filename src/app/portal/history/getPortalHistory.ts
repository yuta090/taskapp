import type { SupabaseClient } from '@supabase/supabase-js'

export interface HistoryItem {
  id: string
  taskId: string
  taskTitle: string
  taskType: 'task' | 'spec'
  action: 'task_approved' | 'changes_requested'
  comment?: string
  timestamp: string
}

export interface PortalHistoryResult {
  history: HistoryItem[]
  historyError: boolean
}

interface AuditLogRow {
  id: string
  target_id: string | null
  event_type: string
  metadata: { comment?: string } | null
  occurred_at: string
}

interface TaskRow {
  id: string
  title: string
  type: 'task' | 'spec'
}

/**
 * audit_logs has no FK relationship to tasks (target_id is a polymorphic
 * reference, not a real FK), so an embedded `tasks!inner(...)` select fails
 * with PGRST200. Fetch audit_logs and tasks separately and merge in JS.
 */
export async function getPortalHistory(
  supabase: SupabaseClient,
  spaceId: string,
  userId: string,
): Promise<PortalHistoryResult> {

  const auditResult = await (supabase as SupabaseClient)
    .from('audit_logs')
    .select('id, target_id, event_type, metadata, occurred_at')
    .eq('space_id', spaceId)
    .eq('actor_id', userId)
    .eq('target_type', 'task')
    .in('event_type', ['approval.approved', 'approval.changes_requested'])
    .order('occurred_at', { ascending: false })
    .limit(50)

  if (auditResult.error) {
    console.error('[Portal History] audit query error:', auditResult.error)
    return { history: [], historyError: true }
  }

  const logs = (auditResult.data || []) as AuditLogRow[]
  const taskIds = Array.from(new Set(logs.map((log) => log.target_id).filter((id): id is string => !!id)))

  const taskMap = new Map<string, TaskRow>()
  if (taskIds.length > 0) {

    const tasksResult = await (supabase as SupabaseClient)
      .from('tasks')
      .select('id, title, type')
      .in('id', taskIds)

    if (tasksResult.error) {
      console.error('[Portal History] tasks query error:', tasksResult.error)
      return { history: [], historyError: true }
    }

    for (const task of (tasksResult.data || []) as TaskRow[]) {
      taskMap.set(task.id, task)
    }
  }

  const history: HistoryItem[] = logs.map((log) => {
    const task = log.target_id ? taskMap.get(log.target_id) : undefined
    return {
      id: log.id,
      taskId: log.target_id || '',
      taskTitle: task?.title || 'Unknown Task',
      taskType: task?.type || 'task',
      action: log.event_type === 'approval.approved' ? 'task_approved' : 'changes_requested',
      comment: log.metadata?.comment,
      timestamp: log.occurred_at,
    }
  })

  return { history, historyError: false }
}
