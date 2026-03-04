import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'

export default async function AdminOrganizationsPage() {
  const admin = createAdminClient()

  const [
    { data: orgs },
    { data: memberships },
    { data: spaces },
    { data: billings },
  ] = await Promise.all([
    admin.from('organizations').select('id, name, created_at').order('created_at', { ascending: false }),
    admin.from('org_memberships').select('org_id, role'),
    admin.from('spaces').select('org_id').is('archived_at', null),
    admin.from('org_billing').select('org_id, plan_id, status'),
  ])

  // 集計マップ
  const memberCountMap = new Map<string, number>()
  const spaceCountMap = new Map<string, number>()
  const billingMap = new Map<string, { plan_id: string; status: string }>()

  memberships?.forEach((m) => {
    memberCountMap.set(m.org_id, (memberCountMap.get(m.org_id) ?? 0) + 1)
  })
  spaces?.forEach((s) => {
    spaceCountMap.set(s.org_id, (spaceCountMap.get(s.org_id) ?? 0) + 1)
  })
  billings?.forEach((b) => {
    billingMap.set(b.org_id, { plan_id: b.plan_id, status: b.status })
  })

  const statusVariant = (status: string) => {
    if (status === 'active') return 'success' as const
    if (status === 'trialing') return 'info' as const
    if (status === 'past_due') return 'danger' as const
    return 'default' as const
  }

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="組織管理"
        description={`${orgs?.length ?? 0} 組織`}
      />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">組織名</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">メンバー</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">スペース</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">プラン</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">ステータス</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">作成日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orgs?.map((org) => {
                const billing = billingMap.get(org.id)
                return (
                  <tr key={org.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{org.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{memberCountMap.get(org.id) ?? 0}</td>
                    <td className="px-4 py-2.5 text-gray-600">{spaceCountMap.get(org.id) ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <AdminBadge variant="default">{billing?.plan_id ?? 'free'}</AdminBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      {billing ? (
                        <AdminBadge variant={statusVariant(billing.status)}>{billing.status}</AdminBadge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {new Date(org.created_at).toLocaleDateString('ja-JP')}
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
