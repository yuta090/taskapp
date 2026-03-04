import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminStatCard } from '@/components/admin/AdminStatCard'

export default async function AdminBillingPage() {
  const admin = createAdminClient()

  const [{ data: billings }, { data: plans }, { data: orgs }] = await Promise.all([
    admin.from('org_billing').select('org_id, plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, created_at'),
    admin.from('plans').select('id, name, projects_limit, members_limit, is_active'),
    admin.from('organizations').select('id, name'),
  ])

  const orgMap = new Map<string, string>()
  orgs?.forEach((o) => orgMap.set(o.id, o.name))

  const planMap = new Map<string, { name: string; projects_limit: number | null; members_limit: number | null }>()
  plans?.forEach((p) => planMap.set(p.id, { name: p.name, projects_limit: p.projects_limit, members_limit: p.members_limit }))

  const activeCount = billings?.filter((b) => b.status === 'active').length ?? 0
  const trialingCount = billings?.filter((b) => b.status === 'trialing').length ?? 0
  const pastDueCount = billings?.filter((b) => b.status === 'past_due').length ?? 0
  const canceledCount = billings?.filter((b) => b.status === 'canceled').length ?? 0

  const statusVariant = (status: string) => {
    if (status === 'active') return 'success' as const
    if (status === 'trialing') return 'info' as const
    if (status === 'past_due') return 'danger' as const
    return 'default' as const
  }

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="課金状況"
        description="組織の課金・プラン状態"
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <AdminStatCard label="アクティブ" value={activeCount} />
        <AdminStatCard label="トライアル" value={trialingCount} />
        <AdminStatCard label="支払い遅延" value={pastDueCount} />
        <AdminStatCard label="キャンセル済み" value={canceledCount} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">組織</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">プラン</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">ステータス</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Stripe</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">期間終了</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">キャンセル予定</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {billings?.map((b) => {
                const plan = planMap.get(b.plan_id)
                return (
                  <tr key={b.org_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{orgMap.get(b.org_id) ?? b.org_id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5">
                      <AdminBadge variant="default">{plan?.name ?? b.plan_id}</AdminBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <AdminBadge variant={statusVariant(b.status)}>{b.status}</AdminBadge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">
                      {b.stripe_customer_id ? b.stripe_customer_id.slice(0, 16) + '...' : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {b.current_period_end ? new Date(b.current_period_end).toLocaleDateString('ja-JP') : '-'}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.cancel_at_period_end ? <AdminBadge variant="warning">予定</AdminBadge> : '-'}
                    </td>
                  </tr>
                )
              })}
              {(!billings || billings.length === 0) && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">課金データがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
