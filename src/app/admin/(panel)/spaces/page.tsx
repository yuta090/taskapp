import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'

export default async function AdminSpacesPage() {
  const admin = createAdminClient()

  const [{ data: spaces }, { data: orgs }, { data: tasks }, { data: members }] = await Promise.all([
    admin.from('spaces').select('id, org_id, name, type, archived_at, created_at').order('created_at', { ascending: false }),
    admin.from('organizations').select('id, name'),
    admin.from('tasks').select('space_id'),
    admin.from('space_memberships').select('space_id'),
  ])

  const orgMap = new Map<string, string>()
  orgs?.forEach((o) => orgMap.set(o.id, o.name))

  const taskCountMap = new Map<string, number>()
  tasks?.forEach((t) => taskCountMap.set(t.space_id, (taskCountMap.get(t.space_id) ?? 0) + 1))

  const memberCountMap = new Map<string, number>()
  members?.forEach((m) => memberCountMap.set(m.space_id, (memberCountMap.get(m.space_id) ?? 0) + 1))

  const activeSpaces = spaces?.filter((s) => !s.archived_at) ?? []
  const archivedSpaces = spaces?.filter((s) => s.archived_at) ?? []

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="スペース管理"
        description={`アクティブ ${activeSpaces.length} / アーカイブ ${archivedSpaces.length}`}
      />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">スペース名</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">組織</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">タイプ</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">ステータス</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">メンバー</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">タスク</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">作成日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {spaces?.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{orgMap.get(s.org_id) ?? '-'}</td>
                  <td className="px-4 py-2.5">
                    <AdminBadge variant={s.type === 'project' ? 'info' : 'default'}>{s.type}</AdminBadge>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.archived_at
                      ? <AdminBadge variant="default">アーカイブ</AdminBadge>
                      : <AdminBadge variant="success">アクティブ</AdminBadge>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{memberCountMap.get(s.id) ?? 0}</td>
                  <td className="px-4 py-2.5 text-gray-600">{taskCountMap.get(s.id) ?? 0}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {new Date(s.created_at).toLocaleDateString('ja-JP')}
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
