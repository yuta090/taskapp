import { createAdminClient } from '@/lib/supabase/admin'
import LogsPageClient, { type AuditLogRow, type TaskEventRow } from './LogsPageClient'

async function fetchLogsData(): Promise<{ auditLogs: AuditLogRow[]; taskEvents: TaskEventRow[] }> {
  const admin = createAdminClient()

  const [logsResult, eventsResult] = await Promise.all([
    admin
      .from('audit_logs')
      .select('id, event_type, target_type, target_id, summary, actor_id, actor_role, visibility, occurred_at, data_before, data_after')
      .order('occurred_at', { ascending: false })
      .limit(500),
    admin
      .from('task_events')
      .select('id, action, task_id, actor_id, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  if (logsResult.error) console.error('[admin/logs] audit_logs query error:', logsResult.error.message)
  if (eventsResult.error) console.error('[admin/logs] task_events query error:', eventsResult.error.message)

  return {
    auditLogs: (logsResult.data as AuditLogRow[]) ?? [],
    taskEvents: (eventsResult.data as TaskEventRow[]) ?? [],
  }
}

export default async function AdminLogsPage() {
  const { auditLogs, taskEvents } = await fetchLogsData()
  return <LogsPageClient initialAuditLogs={auditLogs} initialTaskEvents={taskEvents} />
}
