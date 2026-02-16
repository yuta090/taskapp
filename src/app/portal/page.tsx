import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalDashboardClient } from './PortalDashboardClient'
import type { MilestoneStatus } from '@/components/portal'
import type { SupabaseClient } from '@supabase/supabase-js'

// AT-010: Client dashboard with bento grid layout
// - Modern dashboard with progress ring, milestones, activities
// - ball=client tasks appear first (considering, pending review)
// - Sorted by due_date ASC (null last)

export default async function PortalDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // クライアントの最初のスペースを取得（後続クエリの前提条件）
   
  const { data: membership } = await (supabase as SupabaseClient)
    .from('space_memberships')
    .select(`
      space_id,
      spaces!inner (
        id,
        name,
        org_id
      )
    `)
    .eq('user_id', user.id)
    .eq('role', 'client')
    .limit(1)
    .single()

  if (!membership) {
    // クライアントとしてのスペースがない場合
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">アクセス権限がありません</h1>
          <p className="text-gray-600">招待リンクからアクセスしてください</p>
        </div>
      </div>
    )
  }

  const spaceId = membership.space_id
  const spaceName = (membership.spaces as { name?: string })?.name || 'プロジェクト'
  const orgId = (membership.spaces as { org_id?: string })?.org_id || ''

  // spaceId取得後、全クエリを並列実行
  const [
    consideringResult,
    otherClientResult,
    internalCountResult,
    completedCountResult,
    totalCountResult,
    milestonesResult,
    notificationsResult,
    recentCompletedResult,
    approvalsResult,
  ] = await Promise.all([
    // 1. ball=client + considering (HIGHEST priority)
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id, title, description, status, ball, due_date, type, decision_state, created_at')
      .eq('space_id', spaceId)
      .eq('ball', 'client')
      .eq('status', 'considering')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    // 2. ball=client + other active statuses
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id, title, description, status, ball, due_date, type, decision_state, created_at')
      .eq('space_id', spaceId)
      .eq('ball', 'client')
      .in('status', ['open', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    // 3. ball=internal tasks count
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('space_id', spaceId)
      .eq('ball', 'internal')
      .in('status', ['open', 'in_progress']),
    // 4. Completed tasks count
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('space_id', spaceId)
      .eq('status', 'done'),
    // 5. Total tasks count
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('space_id', spaceId),
    // 6. Milestones
     
    (supabase as SupabaseClient)
      .from('milestones')
      .select('id, name, completed_at, due_date')
      .eq('space_id', spaceId)
      .order('due_date', { ascending: true }),
    // 7. Recent notifications
     
    (supabase as SupabaseClient)
      .from('notifications')
      .select('id, type, payload, created_at')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(10),
    // 8. Recently completed tasks
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id, title, completed_at, updated_at')
      .eq('space_id', spaceId)
      .eq('status', 'done')
      .order('updated_at', { ascending: false })
      .limit(5),
    // 9. Review approvals
     
    (supabase as SupabaseClient)
      .from('review_approvals')
      .select(`
        id,
        created_at,
        reviews!inner (
          id,
          task_id,
          tasks!inner (
            title,
            space_id
          )
        )
      `)
      .eq('reviews.tasks.space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  // エラーチェック（graceful degradation: ログ出力後、空データで続行）
  if (consideringResult.error) console.error('[Portal Dashboard] considering query error:', consideringResult.error)
  if (otherClientResult.error) console.error('[Portal Dashboard] otherClient query error:', otherClientResult.error)
  if (internalCountResult.error) console.error('[Portal Dashboard] internalCount query error:', internalCountResult.error)
  if (completedCountResult.error) console.error('[Portal Dashboard] completedCount query error:', completedCountResult.error)
  if (totalCountResult.error) console.error('[Portal Dashboard] totalCount query error:', totalCountResult.error)
  if (milestonesResult.error) console.error('[Portal Dashboard] milestones query error:', milestonesResult.error)
  if (notificationsResult.error) console.error('[Portal Dashboard] notifications query error:', notificationsResult.error)
  if (recentCompletedResult.error) console.error('[Portal Dashboard] recentCompleted query error:', recentCompletedResult.error)
  if (approvalsResult.error) console.error('[Portal Dashboard] approvals query error:', approvalsResult.error)

  const consideringTasks = consideringResult.data || []
  const otherClientTasks = otherClientResult.data || []
  const internalCount = internalCountResult.count
  const completedCount = completedCountResult.count
  const totalCount = totalCountResult.count
  const milestonesData = milestonesResult.data
  const recentNotifications = notificationsResult.data
  const recentCompletedTasks = recentCompletedResult.data
  const recentApprovals = approvalsResult.data

  // Combine client tasks
  const priorityTasks = consideringTasks || []
  const otherTasks = otherClientTasks || []
  const allClientTasks = [...priorityTasks, ...otherTasks]

  // Calculate overdue (JST-safe: compare YYYY-MM-DD strings in Asia/Tokyo)
  const todayJST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
  const overdueCount = allClientTasks.filter((t: { due_date: string | null }) =>
    t.due_date && t.due_date < todayJST
  ).length

  // JST today as UTC epoch for day-diff calculations
  const [todayY, todayM, todayD] = todayJST.split('-').map(Number)
  const todayUTCMs = Date.UTC(todayY, todayM - 1, todayD)

  // Format tasks for client component
  const actionTasks = allClientTasks.slice(0, 10).map((task: { id: string; title: string; description: string; due_date: string | null; type: string; status: string; created_at: string }) => {
    const isOverdue = task.due_date ? task.due_date < todayJST : false
    let waitingDays: number | undefined
    if (task.due_date && isOverdue) {
      const [dy, dm, dd] = task.due_date.split('-').map(Number)
      waitingDays = Math.floor((todayUTCMs - Date.UTC(dy, dm - 1, dd)) / (1000 * 60 * 60 * 24))
    }
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.due_date,
      isOverdue,
      waitingDays,
      type: (task.type as 'task' | 'spec') || 'task',
      status: task.status,
      createdAt: task.created_at,
    }
  })

  // Format milestones - derive status from completed_at
  const mapMilestoneStatus = (m: { completed_at: string | null; due_date: string | null }): MilestoneStatus => {
    if (m.completed_at) return 'completed'
    if (m.due_date) {
      const now = new Date()
      const due = new Date(m.due_date)
      if (due >= now) return 'current'
    }
    return 'upcoming'
  }

  const milestones = (milestonesData || []).map((m: { id: string; name: string; completed_at: string | null; due_date: string | null }) => ({
    id: m.id,
    name: m.name,
    status: mapMilestoneStatus(m),
    dueDate: m.due_date,
  }))

  // Find next milestone (current or upcoming, sorted by date)
  const upcomingMilestones = milestones
    .filter((m: { dueDate: string | null; status: MilestoneStatus; name: string }) =>
      m.dueDate && m.status !== 'completed'
    )
    .sort((a: { dueDate: string | null }, b: { dueDate: string | null }) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })
  const nextMilestone = upcomingMilestones[0]

  // Calculate milestone overdue (JST-safe: use YYYY-MM-DD string comparison + UTC day diff)
  let milestoneOverdueDays = 0
  if (nextMilestone?.dueDate && todayJST > nextMilestone.dueDate) {
    const [ty, tm, td] = todayJST.split('-').map(Number)
    const [my, mm, md] = nextMilestone.dueDate.split('-').map(Number)
    const todayMs = Date.UTC(ty, tm - 1, td)
    const milestoneMs = Date.UTC(my, mm - 1, md)
    milestoneOverdueDays = Math.floor((todayMs - milestoneMs) / (1000 * 60 * 60 * 24))
  }

  // Format activities from notifications and completed tasks
  const notificationActivities = (recentNotifications || []).map((n: { id: string; type: string; payload: { message?: string }; created_at: string }) => ({
    id: n.id,
    type: 'notification' as const,
    message: n.payload?.message || `${n.type}の通知`,
    timestamp: n.created_at,
  }))

  const completedActivities = (recentCompletedTasks || []).map((t: { id: string; title: string; completed_at: string | null; updated_at: string }) => ({
    id: `completed-${t.id}`,
    type: 'task_completed' as const,
    message: `「${t.title}」が完了しました`,
    timestamp: t.completed_at || t.updated_at,
  }))

  // Combine and sort by timestamp
  const activities = [...notificationActivities, ...completedActivities]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)

  // Format approvals (simplified - may need adjustment based on actual table structure)
  const approvals = (recentApprovals || []).map((a: Record<string, unknown>) => {
    const reviews = a.reviews as Array<{ tasks?: Array<{ title?: string }> }> | undefined
    const taskTitle = reviews?.[0]?.tasks?.[0]?.title || 'タスク'
    return {
      id: a.id as string,
      taskTitle,
      approvedAt: a.created_at as string,
      comment: undefined,
    }
  })

  // Waiting message
  const waitingMessage = allClientTasks.length === 0
    ? 'すべてのタスクが確認済みです'
    : undefined

  // Find next due date
  const taskWithDueDate = allClientTasks.find((t: { due_date: string | null }) => t.due_date)
  const nextDueDate = taskWithDueDate?.due_date || null

  // Build dashboard data
  const dashboardData = {
    health: {
      nextMilestone: nextMilestone ? {
        name: nextMilestone.name,
        date: nextMilestone.dueDate,
        overdueDays: milestoneOverdueDays,
      } : undefined,
    },
    alert: {
      overdueCount,
      nextDueDate,
    },
    actionTasks,
    totalActionCount: allClientTasks.length,
    waitingMessage,
    progress: {
      completedCount: completedCount || 0,
      totalCount: totalCount || 0,
      deadline: milestones.length > 0
        ? milestones.reduce((latest, m) =>
            (m.dueDate && (!latest.dueDate || m.dueDate > latest.dueDate)) ? m : latest
          ).dueDate
        : null,
    },
    milestones,
    ballOwnership: {
      clientCount: allClientTasks.length,
      teamCount: internalCount || 0,
    },
    activities,
    approvals,
  }

  // Build project info
  const currentProject = {
    id: spaceId,
    name: spaceName,
    orgId: orgId,
  }

  // For now, only the current project (TODO: fetch all client projects)
  const projects = [currentProject]

  return (
    <PortalDashboardClient
      currentProject={currentProject}
      projects={projects}
      dashboardData={dashboardData}
    />
  )
}
