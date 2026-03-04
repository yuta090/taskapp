import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchAnalyticsData() {
  const admin = createAdminClient()
  const nowMs = Date.now()
  const nowDate = new Date(nowMs)

  const thirtyDaysAgo = new Date(nowMs - 30 * 86400000)
  const sixMonthsAgo = new Date(nowDate.getFullYear(), nowDate.getMonth() - 5, 1)

  const [
    { data: recentProfiles },
    { count: totalUsers },
    { count: totalOrgs },
    { data: monthlyProfiles },
  ] = await Promise.all([
    admin.from('profiles').select('created_at').gte('created_at', thirtyDaysAgo.toISOString()).order('created_at', { ascending: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin.from('organizations').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('created_at').gte('created_at', sixMonthsAgo.toISOString()),
  ])

  // 日別集計
  const dailyCounts = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(nowMs - i * 86400000)
    dailyCounts.set(formatDate(d), 0)
  }
  recentProfiles?.forEach((p) => {
    const date = formatDate(new Date(p.created_at))
    if (dailyCounts.has(date)) {
      dailyCounts.set(date, (dailyCounts.get(date) ?? 0) + 1)
    }
  })

  // 月別集計
  const monthlyCounts = new Map<string, number>()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyCounts.set(key, 0)
  }
  monthlyProfiles?.forEach((p) => {
    const d = new Date(p.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (monthlyCounts.has(key)) {
      monthlyCounts.set(key, (monthlyCounts.get(key) ?? 0) + 1)
    }
  })

  return {
    totalUsers: totalUsers ?? 0,
    totalOrgs: totalOrgs ?? 0,
    recentCount: recentProfiles?.length ?? 0,
    dailyEntries: Array.from(dailyCounts.entries()),
    monthlyEntries: Array.from(monthlyCounts.entries()),
  }
}

export default async function AdminAnalyticsPage() {
  const { totalUsers, totalOrgs, recentCount, dailyEntries, monthlyEntries } = await fetchAnalyticsData()

  const maxDaily = Math.max(1, ...dailyEntries.map(([, c]) => c))
  const maxMonthly = Math.max(1, ...monthlyEntries.map(([, c]) => c))

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="会員登録アナリティクス"
        description="登録トレンドと統計"
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">総ユーザー</p>
          <p className="text-2xl font-bold text-gray-900">{totalUsers}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">総組織</p>
          <p className="text-2xl font-bold text-gray-900">{totalOrgs}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">直近30日の新規登録</p>
          <p className="text-2xl font-bold text-gray-900">{recentCount}</p>
        </div>
      </div>

      {/* Daily Chart (30 days) */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">日別新規登録 (直近30日)</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
        <div className="flex items-end gap-1" style={{ height: 160 }}>
          {dailyEntries.map(([date, count]) => (
            <div key={date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500">{count > 0 ? count : ''}</span>
              <div
                className="w-full bg-indigo-400 rounded-t transition-all"
                style={{ height: `${(count / maxDaily) * 120}px`, minHeight: count > 0 ? 4 : 0 }}
              />
              {parseInt(date.split('-')[2]) % 5 === 1 && (
                <span className="text-xs text-gray-400 mt-1">{date.slice(5)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Monthly Chart */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">月別新規登録 (直近6ヶ月)</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-end gap-4" style={{ height: 160 }}>
          {monthlyEntries.map(([month, count]) => (
            <div key={month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-sm font-medium text-gray-700">{count}</span>
              <div
                className="w-full bg-indigo-500 rounded-t transition-all"
                style={{ height: `${(count / maxMonthly) * 120}px`, minHeight: count > 0 ? 4 : 0 }}
              />
              <span className="text-xs text-gray-500 mt-1">{month.slice(5)}月</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
