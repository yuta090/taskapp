import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import Link from 'next/link'

export default async function AdminUsersPage() {
  const admin = createAdminClient()

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name, avatar_url, is_superadmin, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  // auth.usersからメール取得
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailMap = new Map<string, string>()
  if (authData?.users) {
    for (const u of authData.users) {
      emailMap.set(u.id, u.email ?? '')
    }
  }

  // org_membershipsでロール取得
  const { data: memberships } = await admin
    .from('org_memberships')
    .select('user_id, role, org_id')

  const membershipMap = new Map<string, { role: string; org_id: string }[]>()
  if (memberships) {
    for (const m of memberships) {
      const list = membershipMap.get(m.user_id) ?? []
      list.push({ role: m.role, org_id: m.org_id })
      membershipMap.set(m.user_id, list)
    }
  }

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="ユーザー管理"
        description={`${profiles?.length ?? 0} ユーザー`}
        actions={
          <Link
            href="/admin/users/create"
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
          >
            新規作成
          </Link>
        }
      />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">名前</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">メール</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">ロール</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">組織数</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">登録日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profiles?.map((p) => {
                const orgs = membershipMap.get(p.id) ?? []
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{p.display_name || '(未設定)'}</span>
                        {p.is_superadmin && <AdminBadge variant="indigo">Admin</AdminBadge>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">
                      {emailMap.get(p.id) || '-'}
                    </td>
                    <td className="px-4 py-2.5">
                      {orgs.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {orgs.map((o, i) => (
                            <AdminBadge
                              key={i}
                              variant={o.role === 'owner' ? 'warning' : o.role === 'client' ? 'info' : 'default'}
                            >
                              {o.role}
                            </AdminBadge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{orgs.length}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {new Date(p.created_at).toLocaleDateString('ja-JP')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
