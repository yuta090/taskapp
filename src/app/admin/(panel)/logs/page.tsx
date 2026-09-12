import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import LogsPageClient, { type AuditLogRow, type TaskEventRow, type AuthEventLogRow } from './LogsPageClient'

async function fetchLogsData(): Promise<{ auditLogs: AuditLogRow[]; taskEvents: TaskEventRow[]; authEventLogs: AuthEventLogRow[] }> {
  const admin = createAdminClient()

  const [logsResult, eventsResult, authResult] = await Promise.all([
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
    admin
      .from('auth_event_logs')
      .select('id, occurred_at, stage, provider, error_code, error_description, user_id, email, ip, user_agent, metadata')
      .order('occurred_at', { ascending: false })
      .limit(200),
  ])

  if (logsResult.error) console.error('[admin/logs] audit_logs query error:', logsResult.error.message)
  if (eventsResult.error) console.error('[admin/logs] task_events query error:', eventsResult.error.message)
  if (authResult.error) console.error('[admin/logs] auth_event_logs query error:', authResult.error.message)

  return {
    auditLogs: (logsResult.data as AuditLogRow[]) ?? [],
    taskEvents: (eventsResult.data as TaskEventRow[]) ?? [],
    authEventLogs: (authResult.data as AuthEventLogRow[]) ?? [],
  }
}

export default async function AdminLogsPage() {
  // (panel) layout でも門番を通しているが、service role でデータを取るページなので
  // データ取得の直前でも確認する（Next.js の推奨: 認可はデータ源の近くで）。
  const currentUserId = await verifySuperadmin()
  if (!currentUserId) redirect('/admin/login')

  const { auditLogs, taskEvents, authEventLogs } = await fetchLogsData()
  return (
    <LogsPageClient
      initialAuditLogs={auditLogs}
      initialTaskEvents={taskEvents}
      initialAuthEventLogs={authEventLogs}
    />
  )
}
