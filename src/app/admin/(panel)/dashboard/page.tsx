import { createAdminClient } from '@/lib/supabase/admin'
import { mapWithConcurrency } from '@/lib/admin/concurrency'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminStatCard } from '@/components/admin/AdminStatCard'

// GoTrue（auth.usersのメール取得）を一斉に呼んでレート制限に当たらないよう絞る
const EMAIL_LOOKUP_CONCURRENCY = 8

interface AuditLogRow {
  id: string
  event_type: string
  summary: string | null
  occurred_at: string
  relativeTime: string
  actor_id: string | null
  actorName: string
}

// profiles.display_name は空文字を許す既定値（NOT NULL）なので、
// 「未設定」の判定には `??` でなく `||` を使う（空文字だとメールを引いていても
// 表示が空欄になってしまうため）
export function resolveActorName(displayName: string | null | undefined, email: string | undefined): string {
  return displayName || email || 'System'
}

function computeRelativeTime(isoString: string, nowMs: number): string {
  const diff = nowMs - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  return `${days}日前`
}

async function fetchStats() {
  const admin = createAdminClient()
  const nowMs = Date.now()
  const thirtyDaysAgo = new Date(nowMs - 30 * 86400000).toISOString()
  const sixtyDaysAgo = new Date(nowMs - 60 * 86400000).toISOString()

  const [
    usersResult,
    orgsResult,
    spacesResult,
    tasksResult,
    newUsersResult,
    prevUsersResult,
    reviewsResult,
    notifsResult,
    paidResult,
  ] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin.from('organizations').select('*', { count: 'exact', head: true }),
    admin.from('spaces').select('*', { count: 'exact', head: true }).is('archived_at', null),
    admin.from('tasks').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
    admin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', sixtyDaysAgo).lt('created_at', thirtyDaysAgo),
    admin.from('reviews').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    admin.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
    admin.from('org_billing').select('*', { count: 'exact', head: true }).in('status', ['active', 'trialing']),
  ])

  if (usersResult.error) console.error('[admin/dashboard] profiles query error:', usersResult.error.message)
  if (orgsResult.error) console.error('[admin/dashboard] organizations query error:', orgsResult.error.message)

  const userCount = usersResult.count ?? 0
  const orgCount = orgsResult.count ?? 0
  const spaceCount = spacesResult.count ?? 0
  const taskCount = tasksResult.count ?? 0
  const newUsers30d = newUsersResult.count ?? 0
  const prevUsers30d = prevUsersResult.count ?? 0
  const pendingReviews = reviewsResult.count ?? 0
  const unreadNotifs = notifsResult.count ?? 0
  const paidOrgs = paidResult.count ?? 0

  const userTrend = prevUsers30d > 0
    ? Math.round(((newUsers30d - prevUsers30d) / prevUsers30d) * 100)
    : newUsers30d > 0 ? 100 : 0

  return {
    userCount, orgCount, spaceCount, taskCount,
    newUsers30d, pendingReviews, unreadNotifs, paidOrgs,
    userTrend,
  }
}

async function fetchRecentActivity(): Promise<AuditLogRow[]> {
  const admin = createAdminClient()
  const nowMs = Date.now()

  // profilesにemail列は無いため、埋め込み(actor_profile)にはdisplay_nameだけを含める
  const { data, error } = await admin
    .from('audit_logs')
    .select('id, event_type, summary, occurred_at, actor_id, actor_profile:profiles!audit_logs_actor_id_fkey(display_name)')
    .order('occurred_at', { ascending: false })
    .limit(8)

  if (error) {
    console.error('[admin/dashboard] audit_logs query error:', error.message)
    return []
  }

  type RawRow = {
    id: string
    event_type: string
    summary: string | null
    occurred_at: string
    actor_id: string | null
    actor_profile: { display_name: string | null } | null
  }

  const rows = ((data as unknown) as RawRow[] | null) ?? []

  // 表示名が無い行だけ、メールを管理用の鍵(admin.auth.admin)で補う
  const missingActorIds = [
    ...new Set(
      rows
        .filter((row) => row.actor_id && !row.actor_profile?.display_name)
        .map((row) => row.actor_id as string)
    ),
  ]
  const missingActorEmails = await mapWithConcurrency(
    missingActorIds,
    EMAIL_LOOKUP_CONCURRENCY,
    async (id): Promise<[string, string | null]> => {
      const { data: authUser } = await admin.auth.admin.getUserById(id)
      return [id, authUser.user?.email ?? null]
    },
  )
  const emailByActorId = new Map<string, string>(
    missingActorEmails.filter((e): e is [string, string] => !!e[1]),
  )

  return rows.map((row) => ({
    id: row.id,
    event_type: row.event_type,
    summary: row.summary,
    occurred_at: row.occurred_at,
    actor_id: row.actor_id,
    actorName: resolveActorName(
      row.actor_profile?.display_name,
      row.actor_id ? emailByActorId.get(row.actor_id) : undefined,
    ),
    relativeTime: computeRelativeTime(row.occurred_at, nowMs),
  }))
}

export default async function AdminDashboardPage() {
  const [stats, activities] = await Promise.all([
    fetchStats(),
    fetchRecentActivity(),
  ])

  const { userCount, orgCount, spaceCount, taskCount, newUsers30d, pendingReviews, unreadNotifs, paidOrgs, userTrend } = stats

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="ダッシュボード"
        description="システム全体の概要"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminStatCard label="総ユーザー数" value={userCount} href="/admin/users" />
        <AdminStatCard label="総組織数" value={orgCount} href="/admin/organizations" />
        <AdminStatCard label="アクティブスペース" value={spaceCount} href="/admin/spaces" />
        <AdminStatCard label="総タスク数" value={taskCount} href="/admin/tables/tasks" />
        <AdminStatCard
          label="直近30日 新規登録"
          value={newUsers30d}
          href="/admin/analytics"
          trend={userTrend !== 0 ? { value: userTrend, label: '前30日比' } : undefined}
        />
        <AdminStatCard label="課金中組織" value={paidOrgs} href="/admin/billing" />
        <AdminStatCard label="オープンレビュー" value={pendingReviews} href="/admin/reviews" />
        <AdminStatCard label="未読通知" value={unreadNotifs} href="/admin/notifications" />
      </div>

      {/* Recent Activity Feed */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">最近のアクティビティ</h2>
        {activities.length === 0 ? (
          <p className="text-sm text-gray-400">アクティビティはありません</p>
        ) : (
          <div className="bg-surface rounded-xl border border-gray-200 divide-y divide-gray-100">
            {activities.map((log) => (
              <div key={log.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">
                    <span className="font-medium">{log.actorName}</span>
                    {' '}
                    <span className="text-gray-500">{log.summary ?? log.event_type}</span>
                  </p>
                </div>
                <time className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                  {log.relativeTime}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
