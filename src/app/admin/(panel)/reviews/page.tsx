import { createAdminClient } from '@/lib/supabase/admin'
import ReviewsPageClient, { type ReviewRow } from './ReviewsPageClient'

async function fetchReviewsData(): Promise<ReviewRow[]> {
  const admin = createAdminClient()
  const now = Date.now()

  const [reviewsResult, tasksResult, spacesResult, approvalsResult] = await Promise.all([
    admin.from('reviews').select('id, org_id, space_id, task_id, status, created_at, updated_at').order('created_at', { ascending: true }),
    admin.from('tasks').select('id, title'),
    admin.from('spaces').select('id, name'),
    admin.from('review_approvals').select('review_id, state'),
  ])

  if (reviewsResult.error) console.error('[admin/reviews] reviews query error:', reviewsResult.error.message)
  if (tasksResult.error) console.error('[admin/reviews] tasks query error:', tasksResult.error.message)
  if (spacesResult.error) console.error('[admin/reviews] spaces query error:', spacesResult.error.message)
  if (approvalsResult.error) console.error('[admin/reviews] review_approvals query error:', approvalsResult.error.message)

  const taskMap = new Map<string, string>()
  ;((tasksResult.data as Array<{ id: string; title: string }>) ?? []).forEach((t) => taskMap.set(t.id, t.title))

  const spaceMap = new Map<string, string>()
  ;((spacesResult.data as Array<{ id: string; name: string }>) ?? []).forEach((s) => spaceMap.set(s.id, s.name))

  const approvalMap = new Map<string, { pending: number; approved: number; blocked: number }>()
  ;((approvalsResult.data as Array<{ review_id: string; state: string }>) ?? []).forEach((a) => {
    const entry = approvalMap.get(a.review_id) ?? { pending: 0, approved: 0, blocked: 0 }
    if (a.state === 'pending') entry.pending++
    else if (a.state === 'approved') entry.approved++
    else if (a.state === 'blocked') entry.blocked++
    approvalMap.set(a.review_id, entry)
  })

  return ((reviewsResult.data as Array<{
    id: string; org_id: string; space_id: string; task_id: string
    status: string; created_at: string; updated_at: string
  }>) ?? []).map((r) => {
    const approval = approvalMap.get(r.id)
    const summary = approval
      ? `${approval.approved}承認 / ${approval.pending}待ち / ${approval.blocked}ブロック`
      : '-'
    return {
      id: r.id,
      task_id: r.task_id,
      space_id: r.space_id,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      taskTitle: taskMap.get(r.task_id) ?? r.task_id.slice(0, 8),
      spaceName: spaceMap.get(r.space_id) ?? '-',
      approvalSummary: summary,
      days: Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
    }
  })
}

export default async function AdminReviewsPage() {
  const rows = await fetchReviewsData()
  return <ReviewsPageClient initialData={rows} />
}
