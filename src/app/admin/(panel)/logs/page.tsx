import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminJsonViewer } from '@/components/admin/AdminJsonViewer'

export default async function AdminLogsPage() {
  const admin = createAdminClient()

  const [{ data: auditLogs }, { data: taskEvents }] = await Promise.all([
    admin
      .from('audit_logs')
      .select('id, event_type, target_type, target_id, summary, actor_id, actor_role, visibility, occurred_at, data_before, data_after')
      .order('occurred_at', { ascending: false })
      .limit(100),
    admin
      .from('task_events')
      .select('id, action, task_id, actor_id, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="ログビューア"
        description="監査ログ・タスクイベント"
      />

      {/* Audit Logs */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">監査ログ (直近100件)</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">日時</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">イベント</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">対象</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">概要</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">変更後</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {auditLogs?.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.occurred_at).toLocaleString('ja-JP')}
                  </td>
                  <td className="px-4 py-2.5">
                    <AdminBadge variant="info">{log.event_type}</AdminBadge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">
                    {log.target_type}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate">
                    {log.summary || '-'}
                  </td>
                  <td className="px-4 py-2.5 max-w-xs">
                    {log.data_after ? <AdminJsonViewer data={log.data_after} /> : '-'}
                  </td>
                </tr>
              ))}
              {(!auditLogs || auditLogs.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ログがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Task Events */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">タスクイベント (直近50件)</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">日時</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">アクション</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Task ID</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">ペイロード</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {taskEvents?.map((evt) => (
                <tr key={evt.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(evt.created_at).toLocaleString('ja-JP')}
                  </td>
                  <td className="px-4 py-2.5">
                    <AdminBadge variant="default">{evt.action}</AdminBadge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 font-mono">
                    {evt.task_id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-2.5 max-w-sm">
                    <AdminJsonViewer data={evt.payload} />
                  </td>
                </tr>
              ))}
              {(!taskEvents || taskEvents.length === 0) && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">イベントがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
