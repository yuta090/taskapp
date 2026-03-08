import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface UsageLog {
  id: string
  tool_name: string
  status: string
  error_message: string | null
  response_ms: number | null
  created_at: string
  org_id: string
  user_id: string | null
  api_key_id: string | null
}

interface OrgRow {
  id: string
  name: string
}

interface ProfileRow {
  id: string
  display_name: string | null
  email: string | null
}

/** tool_name → 日本語の機能名マッピング */
const TOOL_LABELS: Record<string, string> = {
  // タスク
  task_create: 'タスク作成',
  task_update: 'タスク更新',
  task_list: 'タスク一覧',
  task_get: 'タスク詳細',
  task_delete: 'タスク削除',
  task_list_my: '自分のタスク',
  task_stale: '停滞タスク',
  // ボール
  ball_pass: 'ボールパス',
  ball_query: 'ボール照会',
  dashboard_get: 'ダッシュボード',
  // スペース
  space_create: 'スペース作成',
  space_update: 'スペース更新',
  space_list: 'スペース一覧',
  space_get: 'スペース詳細',
  // マイルストーン
  milestone_create: 'マイルストーン作成',
  milestone_update: 'マイルストーン更新',
  milestone_list: 'マイルストーン一覧',
  milestone_get: 'マイルストーン詳細',
  milestone_delete: 'マイルストーン削除',
  // ミーティング
  meeting_create: 'ミーティング作成',
  meeting_start: 'ミーティング開始',
  meeting_end: 'ミーティング終了',
  meeting_list: 'ミーティング一覧',
  meeting_get: 'ミーティング詳細',
  // 議事録
  minutes_get: '議事録取得',
  minutes_update: '議事録更新',
  minutes_append: '議事録追記',
  // レビュー
  review_open: 'レビュー起票',
  review_approve: 'レビュー承認',
  review_block: 'レビュー差戻',
  review_list: 'レビュー一覧',
  review_get: 'レビュー詳細',
  // Wiki
  wiki_list: 'Wiki一覧',
  wiki_get: 'Wiki詳細',
  wiki_create: 'Wiki作成',
  wiki_update: 'Wiki更新',
  wiki_delete: 'Wiki削除',
  wiki_versions: 'Wiki履歴',
  // クライアント
  client_invite_create: 'クライアント招待',
  client_invite_bulk_create: 'クライアント一括招待',
  client_list: 'クライアント一覧',
  client_get: 'クライアント詳細',
  client_update: 'クライアント更新',
  client_add_to_space: 'クライアントをスペースに追加',
  client_invite_list: '招待一覧',
  client_invite_resend: '招待再送',
  // アクティビティ
  activity_log: 'アクティビティ記録',
  activity_search: 'アクティビティ検索',
  activity_entity_history: 'エンティティ履歴',
  // 日程調整
  list_scheduling_proposals: '日程調整一覧',
  create_scheduling_proposal: '日程調整作成',
  respond_to_proposal: '日程調整回答',
  confirm_proposal_slot: '日程確定',
  cancel_scheduling_proposal: '日程調整キャンセル',
  get_proposal_responses: '回答状況',
  suggest_available_slots: '空き時間提案',
  send_proposal_reminder: 'リマインダー送信',
}

function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchCliUsageData() {
  const admin = createAdminClient()
  const nowMs = Date.now()
  const thirtyDaysAgo = new Date(nowMs - 30 * 86400000)

  // Fetch logs, orgs, profiles in parallel
  const [logsResult, orgsResult, profilesResult] = await Promise.all([
    admin
      .from('cli_usage_logs')
      .select('id, tool_name, status, error_message, response_ms, created_at, org_id, user_id, api_key_id')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5000),
    admin.from('organizations').select('id, name'),
    admin.from('profiles').select('id, display_name, email'),
  ])

  const logs = (logsResult.data ?? []) as UsageLog[]
  const orgMap = new Map<string, string>()
  ;(orgsResult.data as OrgRow[] | null)?.forEach((o) => orgMap.set(o.id, o.name))
  const profileMap = new Map<string, string>()
  ;(profilesResult.data as ProfileRow[] | null)?.forEach((p) =>
    profileMap.set(p.id, p.display_name || p.email || p.id.slice(0, 8))
  )

  // Summary
  const totalCount = logs.length
  const errorCount = logs.filter((l) => l.status === 'error').length
  const uniqueUsers = new Set(logs.map((l) => l.user_id).filter(Boolean)).size
  const responseTimes = logs.map((l) => l.response_ms).filter((ms): ms is number => ms != null)
  const avgResponseMs = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0

  // Daily counts (30 days)
  const dailyCounts = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    dailyCounts.set(formatDate(new Date(nowMs - i * 86400000)), 0)
  }
  logs.forEach((l) => {
    const date = formatDate(new Date(l.created_at))
    if (dailyCounts.has(date)) {
      dailyCounts.set(date, (dailyCounts.get(date) ?? 0) + 1)
    }
  })

  // Command ranking
  const commandCounts = new Map<string, number>()
  logs.forEach((l) => {
    commandCounts.set(l.tool_name, (commandCounts.get(l.tool_name) ?? 0) + 1)
  })
  const commandRanking = Array.from(commandCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  // Org ranking
  const orgCounts = new Map<string, number>()
  logs.forEach((l) => {
    orgCounts.set(l.org_id, (orgCounts.get(l.org_id) ?? 0) + 1)
  })
  const orgRanking = Array.from(orgCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([orgId, count]) => ({ name: orgMap.get(orgId) ?? orgId.slice(0, 8), count }))

  // Recent logs (latest 50)
  const recentLogs = logs.slice(0, 50).map((l) => ({
    id: l.id,
    toolName: l.tool_name,
    status: l.status,
    errorMessage: l.error_message,
    responseMs: l.response_ms,
    createdAt: l.created_at,
    orgName: orgMap.get(l.org_id) ?? l.org_id.slice(0, 8),
    userName: l.user_id ? (profileMap.get(l.user_id) ?? l.user_id.slice(0, 8)) : '-',
  }))

  return {
    totalCount,
    errorCount,
    uniqueUsers,
    avgResponseMs,
    dailyEntries: Array.from(dailyCounts.entries()),
    commandRanking,
    orgRanking,
    recentLogs,
  }
}

export default async function AdminCliUsagePage() {
  const {
    totalCount,
    errorCount,
    uniqueUsers,
    avgResponseMs,
    dailyEntries,
    commandRanking,
    orgRanking,
    recentLogs,
  } = await fetchCliUsageData()

  const maxDaily = Math.max(1, ...dailyEntries.map(([, c]) => c))
  const maxCommand = Math.max(1, ...commandRanking.map(([, c]) => c))
  const maxOrg = Math.max(1, ...orgRanking.map((o) => o.count))
  const errorRate = totalCount > 0 ? ((errorCount / totalCount) * 100).toFixed(1) : '0.0'

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="CLI 利用統計"
        description="agentpm CLI の機能別・顧客別利用状況（直近30日）"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">総実行数</p>
          <p className="text-2xl font-bold text-gray-900">{totalCount.toLocaleString()}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">ユニークユーザー</p>
          <p className="text-2xl font-bold text-gray-900">{uniqueUsers}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">エラー率</p>
          <p className={`text-2xl font-bold ${Number(errorRate) > 5 ? 'text-red-600' : 'text-gray-900'}`}>
            {errorRate}%
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">平均応答時間</p>
          <p className="text-2xl font-bold text-gray-900">{avgResponseMs.toLocaleString()}ms</p>
        </div>
      </div>

      {/* Daily Chart */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">日別実行数（直近30日）</h2>
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

      {/* Rankings */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Command Ranking */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-3">機能別ランキング</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
            {commandRanking.length === 0 && (
              <p className="text-sm text-gray-400">データなし</p>
            )}
            {commandRanking.map(([name, count]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 w-44 truncate shrink-0" title={name}>
                  {getToolLabel(name)}
                </span>
                <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 rounded"
                    style={{ width: `${(count / maxCommand) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600 w-10 text-right shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Org Ranking */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-3">組織別ランキング</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
            {orgRanking.length === 0 && (
              <p className="text-sm text-gray-400">データなし</p>
            )}
            {orgRanking.map((org) => (
              <div key={org.name} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 w-40 truncate shrink-0">{org.name}</span>
                <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded"
                    style={{ width: `${(org.count / maxOrg) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600 w-10 text-right shrink-0">{org.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Logs Table */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">直近のログ</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">時刻</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">組織</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">ユーザー</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">機能</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">ステータス</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">応答時間</th>
            </tr>
          </thead>
          <tbody>
            {recentLogs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  まだログがありません
                </td>
              </tr>
            )}
            {recentLogs.map((log) => (
              <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                </td>
                <td className="px-4 py-2 text-gray-700">{log.orgName}</td>
                <td className="px-4 py-2 text-gray-700">{log.userName}</td>
                <td className="px-4 py-2 text-gray-700" title={log.toolName}>
                  {getToolLabel(log.toolName)}
                </td>
                <td className="px-4 py-2">
                  {log.status === 'success' ? (
                    <span className="inline-flex items-center text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      OK
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full cursor-help"
                      title={log.errorMessage ?? ''}
                    >
                      Error
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500 text-right whitespace-nowrap">
                  {log.responseMs != null ? `${log.responseMs}ms` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
