import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminStatCard } from '@/components/admin/AdminStatCard'
import { MilestoneReconcileButton } from '@/components/admin/MilestoneReconcileButton'
import {
  buildFunnelReport,
  CHANNEL_TABLE_STEPS,
  getMilestoneLabel,
  type MilestoneStatRow,
} from '@/lib/analytics/milestones'

export const dynamic = 'force-dynamic'

/** コホート（期間内に作成された組織）の切り替え。既定は直近90日 */
const PERIODS = [
  { key: '30', label: '直近30日', days: 30 },
  { key: '90', label: '直近90日', days: 90 },
  { key: '180', label: '直近180日', days: 180 },
  { key: 'all', label: '全期間', days: null },
] as const
type PeriodKey = (typeof PERIODS)[number]['key']

function resolvePeriod(raw: string | undefined): (typeof PERIODS)[number] {
  return PERIODS.find((p) => p.key === raw) ?? PERIODS[1]
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchAnalyticsData(period: (typeof PERIODS)[number]) {
  const admin = createAdminClient()
  const nowMs = Date.now()
  const nowDate = new Date(nowMs)

  const thirtyDaysAgo = new Date(nowMs - 30 * 86400000)
  const sixMonthsAgo = new Date(nowDate.getFullYear(), nowDate.getMonth() - 5, 1)
  // timestamptz に渡す完全な時刻なので日付ずれ(toISOString禁止ルール)の対象外
  const since = period.days == null ? null : new Date(nowMs - period.days * 86400000).toISOString()

  const [
    { data: recentProfiles },
    { count: totalUsers },
    { count: totalOrgs },
    { data: monthlyProfiles },
    statsResult,
    lastReconcileResult,
    periodUsersResult,
  ] = await Promise.all([
    admin.from('profiles').select('created_at').gte('created_at', thirtyDaysAgo.toISOString()).order('created_at', { ascending: true }),
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin.from('organizations').select('*', { count: 'exact', head: true }),
    admin.from('profiles').select('created_at').gte('created_at', sixMonthsAgo.toISOString()),
    admin.rpc('admin_org_milestone_stats', { p_since: since }),
    admin.from('org_milestones').select('recorded_at').order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
    since
      ? admin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', since)
      : admin.from('profiles').select('*', { count: 'exact', head: true }),
  ])

  if (statsResult.error) console.error('[admin/analytics] admin_org_milestone_stats error:', statsResult.error.message)
  if (lastReconcileResult.error) console.error('[admin/analytics] org_milestones query error:', lastReconcileResult.error.message)

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

  const report = buildFunnelReport(((statsResult.data as unknown) as MilestoneStatRow[] | null) ?? [])

  return {
    totalUsers: totalUsers ?? 0,
    totalOrgs: totalOrgs ?? 0,
    recentCount: recentProfiles?.length ?? 0,
    periodUsers: periodUsersResult.count ?? 0,
    dailyEntries: Array.from(dailyCounts.entries()),
    monthlyEntries: Array.from(monthlyCounts.entries()),
    report,
    lastReconciledAt: (lastReconcileResult.data as { recorded_at: string } | null)?.recorded_at ?? null,
  }
}

function PeriodTabs({ current }: { current: PeriodKey }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-surface p-0.5">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`/admin/analytics?period=${p.key}`}
          className={`px-3 py-1 text-xs rounded-md ${
            p.key === current ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {p.label}
        </Link>
      ))}
    </div>
  )
}

function fmtDays(v: number | null): string {
  if (v == null) return '-'
  if (v < 1) return '当日'
  return `${v}日`
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: rawPeriod } = await searchParams
  const period = resolvePeriod(rawPeriod)
  const { totalUsers, totalOrgs, recentCount, periodUsers, dailyEntries, monthlyEntries, report, lastReconciledAt } =
    await fetchAnalyticsData(period)

  const maxDaily = Math.max(1, ...dailyEntries.map(([, c]) => c))
  const maxMonthly = Math.max(1, ...monthlyEntries.map(([, c]) => c))

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="会員登録アナリティクス"
        description="登録トレンドと、登録後にどこまで進んだか（節目）・どこから来たか（流入経路）"
      />

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <AdminStatCard label="総ユーザー" value={totalUsers} />
        <AdminStatCard label="総組織" value={totalOrgs} href="/admin/organizations" />
        <AdminStatCard label="直近30日の新規登録" value={recentCount} />
        <AdminStatCard
          label={`${period.label}の組織作成`}
          value={report.cohortOrgCount}
          sub={`同期間の登録ユーザー ${periodUsers}人`}
        />
      </div>

      {/* Funnel */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-medium text-gray-700">登録後のファネル</h2>
          <p className="text-xs text-gray-400">
            {period.label}に作成された組織 {report.cohortOrgCount} 件が、各節目にどれだけ到達したか
          </p>
        </div>
        <PeriodTabs current={period.key} />
      </div>
      <div className="bg-surface border border-gray-200 rounded-xl p-5 mb-8">
        {report.cohortOrgCount === 0 ? (
          <p className="text-sm text-gray-400">この期間に作成された組織はありません</p>
        ) : (
          <ol className="space-y-3">
            {report.funnel.map((step, idx) => (
              <li key={step.key} className="grid grid-cols-[1.5rem_11rem_1fr_8rem] items-center gap-3">
                <span className="text-xs text-gray-400 text-right">{idx + 1}</span>
                <span className="text-sm text-gray-800">{step.label}</span>
                <div className="h-6 rounded bg-gray-100 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded"
                    style={{ width: `${Math.max(step.rateOfCohort, step.reached > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <div className="text-right leading-tight">
                  <div className="text-sm font-semibold text-gray-900">
                    {step.reached}
                    <span className="ml-1 text-xs font-normal text-gray-500">({step.rateOfCohort}%)</span>
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {idx > 0 && `前段比 ${step.rateOfPrev}%・`}中央値 {fmtDays(step.medianDays)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* By channel */}
      <h2 className="text-sm font-medium text-gray-700 mb-1">流入経路別の到達</h2>
      <p className="text-xs text-gray-400 mb-3">
        どこから来た組織が定着・有料化しているか。流入経路は組織作成時に自動判定し、組織詳細ページで運営が直せます
      </p>
      <div className="bg-surface border border-gray-200 rounded-xl mb-8 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">流入経路</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">組織数</th>
              {CHANNEL_TABLE_STEPS.map((key) => (
                <th key={key} className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">
                  {getMilestoneLabel(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {report.byChannel.length === 0 && (
              <tr>
                <td colSpan={2 + CHANNEL_TABLE_STEPS.length} className="px-5 py-6 text-center text-sm text-gray-400">
                  データがありません
                </td>
              </tr>
            )}
            {report.byChannel.map((row) => (
              <tr key={row.channel} className="hover:bg-gray-50">
                <td className="px-5 py-2.5 text-sm text-gray-800">{row.label}</td>
                <td className="px-3 py-2.5 text-sm text-right font-semibold text-gray-900">{row.orgCount}</td>
                {row.steps.map((s) => (
                  <td key={s.key} className="px-3 py-2.5 text-sm text-right text-gray-700 whitespace-nowrap">
                    {s.reached}
                    <span className="ml-1 text-xs text-gray-400">({s.rate}%)</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* All milestones */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-medium text-gray-700">すべての節目</h2>
          <p className="text-xs text-gray-400">
            毎時自動で集計しています（最終記録 {formatDateTime(lastReconciledAt)}）
          </p>
        </div>
        <MilestoneReconcileButton />
      </div>
      <div className="bg-surface border border-gray-200 rounded-xl mb-8 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">分類</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">節目</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">判定のしかた</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">到達</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">到達率</th>
              <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">作成からの中央値</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {report.all.map((m) => (
              <tr key={m.key} className="hover:bg-gray-50">
                <td className="px-5 py-2 text-xs text-gray-500 whitespace-nowrap">{m.groupLabel}</td>
                <td className="px-3 py-2 text-sm text-gray-800 whitespace-nowrap">{m.label}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{m.description}</td>
                <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900">{m.reached}</td>
                <td className="px-3 py-2 text-sm text-right text-gray-700">{m.rate}%</td>
                <td className="px-5 py-2 text-sm text-right text-gray-700">{fmtDays(m.medianDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily Chart (30 days) */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">日別新規登録 (直近30日)</h2>
      <div className="bg-surface border border-gray-200 rounded-xl p-5 mb-8">
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
      <div className="bg-surface border border-gray-200 rounded-xl p-5">
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
