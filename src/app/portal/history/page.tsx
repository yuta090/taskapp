import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalHistoryClient } from './PortalHistoryClient'

export default async function PortalHistoryPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get client's spaces
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberships } = await (supabase as any)
    .from('space_memberships')
    .select(`
      space_id,
      spaces!inner (
        id,
        name,
        org_id,
        organizations!inner (
          id,
          name
        )
      )
    `)
    .eq('user_id', user.id)
    .eq('role', 'client')

  if (!memberships || memberships.length === 0) {
    return (
      <div className="min-h-screen bg-[#F7F7F5] flex items-center justify-center">
        <div className="text-center bg-white rounded-xl border border-gray-200 shadow-sm p-8 max-w-md">
          <h1 className="text-xl font-bold text-gray-900 mb-2">アクセス権限がありません</h1>
          <p className="text-gray-600">招待リンクからアクセスしてください</p>
        </div>
      </div>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projects = memberships.map((m: any) => ({
    id: m.space_id,
    name: m.spaces?.name || 'プロジェクト',
    orgId: m.spaces?.org_id,
    orgName: m.spaces?.organizations?.name || '組織',
  }))

  const currentProject = projects[0]
  const spaceId = currentProject.id

  // audit_logs と completed tasks を並列取得
  const [auditResult, completedResult] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('audit_logs')
      .select(`
        id,
        task_id,
        action,
        payload,
        created_at,
        tasks!inner (
          id,
          title,
          type
        )
      `)
      .eq('space_id', spaceId)
      .eq('actor_id', user.id)
      .in('action', ['task_approved', 'changes_requested'])
      .order('created_at', { ascending: false })
      .limit(50),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('tasks')
      .select('id, title, type, status, updated_at')
      .eq('space_id', spaceId)
      .eq('status', 'done')
      .order('updated_at', { ascending: false })
      .limit(50),
  ])

  // エラーログ（graceful degradation）
  if (auditResult.error) console.error('[Portal History] audit query error:', auditResult.error)
  if (completedResult.error) console.error('[Portal History] completed query error:', completedResult.error)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = (auditResult.data || []).map((log: any) => ({
    id: log.id,
    taskId: log.task_id,
    taskTitle: log.tasks?.title || 'Unknown Task',
    taskType: log.tasks?.type as 'task' | 'spec',
    action: log.action as 'task_approved' | 'changes_requested',
    comment: log.payload?.comment,
    timestamp: log.created_at,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completed = (completedResult.data || []).map((task: any) => ({
    id: task.id,
    title: task.title,
    type: task.type as 'task' | 'spec',
    completedAt: task.updated_at,
  }))

  return (
    <PortalHistoryClient
      currentProject={currentProject}
      projects={projects}
      history={history}
      completedTasks={completed}
    />
  )
}
