import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminStatCard } from '@/components/admin/AdminStatCard'

async function fetchStats() {
  const admin = createAdminClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

  const [
    { count: userCount },
    { count: orgCount },
    { count: spaceCount },
    { count: taskCount },
    { count: newUsers30d },
    { count: pendingReviews },
    { count: unreadNotifs },
    { data: billingData },
  ] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin.from('organizations').select('*', { count: 'exact', head: true }),
    admin.from('spaces').select('*', { count: 'exact', head: true }).is('archived_at', null),
    admin.from('tasks').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
    admin.from('reviews').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    admin.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
    admin.from('org_billing').select('status'),
  ])

  const paidOrgs = billingData?.filter((b: { status: string }) => b.status === 'active' || b.status === 'trialing').length ?? 0

  return { userCount, orgCount, spaceCount, taskCount, newUsers30d, pendingReviews, unreadNotifs, paidOrgs }
}

export default async function AdminDashboardPage() {
  const { userCount, orgCount, spaceCount, taskCount, newUsers30d, pendingReviews, unreadNotifs, paidOrgs } = await fetchStats()

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="ダッシュボード"
        description="システム全体の概要"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminStatCard label="総ユーザー数" value={userCount ?? 0} />
        <AdminStatCard label="総組織数" value={orgCount ?? 0} />
        <AdminStatCard label="アクティブスペース" value={spaceCount ?? 0} />
        <AdminStatCard label="総タスク数" value={taskCount ?? 0} />
        <AdminStatCard label="直近30日 新規登録" value={newUsers30d ?? 0} />
        <AdminStatCard label="課金中組織" value={paidOrgs} />
        <AdminStatCard label="オープンレビュー" value={pendingReviews ?? 0} />
        <AdminStatCard label="未読通知" value={unreadNotifs ?? 0} />
      </div>
    </div>
  )
}
