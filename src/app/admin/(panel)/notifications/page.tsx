import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminStatCard } from '@/components/admin/AdminStatCard'
import {
  getNotificationTypeLabel,
  getNotificationTypeDescription,
  getNotificationChannelLabel,
} from '@/lib/notifications/labels'

export default async function AdminNotificationsPage() {
  // (panel) layout でも門番を通しているが、service role でデータを取るページなので
  // データ取得の直前でも確認する（Next.js の推奨: 認可はデータ源の近くで）。
  const currentUserId = await verifySuperadmin()
  if (!currentUserId) redirect('/admin/login')

  const admin = createAdminClient()

  const [
    { count: totalCount },
    { count: unreadCount },
    { data: recentNotifs },
    { data: typeBreakdown },
  ] = await Promise.all([
    admin.from('notifications').select('*', { count: 'exact', head: true }),
    admin.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
    admin.from('notifications').select('id, type, channel, to_user_id, read_at, created_at').order('created_at', { ascending: false }).limit(50),
    admin.from('notifications').select('type'),
  ])

  // タイプ別集計
  const typeCounts = new Map<string, number>()
  typeBreakdown?.forEach((n) => {
    typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1)
  })

  const total = totalCount ?? 0
  const unread = unreadCount ?? 0
  const readRate = total > 0 ? Math.round(((total - unread) / total) * 100) : 0

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="通知配信状況"
        description="通知の配信・既読統計"
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <AdminStatCard label="総通知数" value={total} />
        <AdminStatCard label="未読" value={unread} />
        <AdminStatCard label="既読率" value={`${readRate}%`} />
      </div>

      {/* Type breakdown */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">種類別（どの通知が多いか）</h2>
      <div className="grid grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {Array.from(typeCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <div key={type} className="bg-surface border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-medium text-gray-900">{getNotificationTypeLabel(type)}</p>
              <p className="text-lg font-bold text-gray-900">{count}</p>
              <p className="mt-1 text-xs text-gray-500">{getNotificationTypeDescription(type)}</p>
              <p className="mt-1 text-[10px] text-gray-400 font-mono">{type}</p>
            </div>
          ))}
      </div>

      {/* Recent */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">直近の通知 (50件)</h2>
      <div className="bg-surface border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">日時</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">種類</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">チャンネル</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">既読</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentNotifs?.map((n) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(n.created_at).toLocaleString('ja-JP')}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-700" title={n.type}>
                    {getNotificationTypeLabel(n.type)}
                    <span className="ml-1.5 text-[10px] text-gray-400 font-mono">{n.type}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{getNotificationChannelLabel(n.channel)}</td>
                  <td className="px-4 py-2.5">
                    {n.read_at
                      ? <span className="text-green-600 text-xs">既読</span>
                      : <span className="text-amber-600 text-xs">未読</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
