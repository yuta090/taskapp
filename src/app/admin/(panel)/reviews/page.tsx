import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'

interface ReviewRow {
  id: string
  task_id: string
  space_id: string
  status: string
  created_at: string
  updated_at: string
  taskTitle: string
  spaceName: string
  approval: { pending: number; approved: number; blocked: number } | null
  days: number
}

async function fetchReviewData() {
  const admin = createAdminClient()
  const nowMs = Date.now()

  const [{ data: reviews }, { data: tasks }, { data: spaces }, { data: approvals }] = await Promise.all([
    admin.from('reviews').select('id, org_id, space_id, task_id, status, created_at, updated_at').order('created_at', { ascending: true }),
    admin.from('tasks').select('id, title'),
    admin.from('spaces').select('id, name'),
    admin.from('review_approvals').select('review_id, state'),
  ])

  const taskMap = new Map<string, string>()
  tasks?.forEach((t) => taskMap.set(t.id, t.title))

  const spaceMap = new Map<string, string>()
  spaces?.forEach((s) => spaceMap.set(s.id, s.name))

  const approvalMap = new Map<string, { pending: number; approved: number; blocked: number }>()
  approvals?.forEach((a) => {
    const entry = approvalMap.get(a.review_id) ?? { pending: 0, approved: 0, blocked: 0 }
    if (a.state === 'pending') entry.pending++
    else if (a.state === 'approved') entry.approved++
    else if (a.state === 'blocked') entry.blocked++
    approvalMap.set(a.review_id, entry)
  })

  const rows: ReviewRow[] = (reviews ?? []).map((r) => ({
    id: r.id,
    task_id: r.task_id,
    space_id: r.space_id,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    taskTitle: taskMap.get(r.task_id) ?? r.task_id.slice(0, 8),
    spaceName: spaceMap.get(r.space_id) ?? '-',
    approval: approvalMap.get(r.id) ?? null,
    days: Math.floor((nowMs - new Date(r.created_at).getTime()) / 86400000),
  }))

  return {
    openReviews: rows.filter((r) => r.status === 'open'),
    closedReviews: rows.filter((r) => r.status !== 'open'),
  }
}

function statusVariant(status: string) {
  if (status === 'approved') return 'success' as const
  if (status === 'changes_requested') return 'danger' as const
  return 'warning' as const
}

export default async function AdminReviewsPage() {
  const { openReviews, closedReviews } = await fetchReviewData()

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="レビュー滞留"
        description={`オープン ${openReviews.length} / クローズ ${closedReviews.length}`}
      />

      <h2 className="text-sm font-medium text-gray-700 mb-3">オープンレビュー (古い順)</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">タスク</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">スペース</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">承認状況</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">経過日数</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">作成日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {openReviews.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-xs truncate">{r.taskTitle}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.spaceName}</td>
                  <td className="px-4 py-2.5">
                    {r.approval ? (
                      <span className="text-xs text-gray-600">
                        {r.approval.approved}承認 / {r.approval.pending}待ち / {r.approval.blocked}ブロック
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <AdminBadge variant={r.days > 7 ? 'danger' : r.days > 3 ? 'warning' : 'default'}>
                      {r.days}日
                    </AdminBadge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {new Date(r.created_at).toLocaleDateString('ja-JP')}
                  </td>
                </tr>
              ))}
              {openReviews.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">オープンレビューはありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="text-sm font-medium text-gray-700 mb-3">クローズ済み (直近)</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">タスク</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">ステータス</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">更新日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {closedReviews.slice(-20).reverse().map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-900">{r.taskTitle}</td>
                  <td className="px-4 py-2.5"><AdminBadge variant={statusVariant(r.status)}>{r.status}</AdminBadge></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{new Date(r.updated_at).toLocaleDateString('ja-JP')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
