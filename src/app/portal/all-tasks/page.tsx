import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalAllTasksClient } from './PortalAllTasksClient'
import type { SupabaseClient } from '@supabase/supabase-js'

export default async function PortalAllTasksPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get client's spaces
   
  const { data: memberships } = await (supabase as SupabaseClient)
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

  // milestones, tasks, actionCount を並列取得
  const [milestonesResult, tasksResult, actionCountResult] = await Promise.all([
     
    (supabase as SupabaseClient)
      .from('milestones')
      .select('id, name, due_date, order_key')
      .eq('space_id', spaceId)
      .order('order_key', { ascending: true }),
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id, title, status, ball, due_date, type, decision_state, created_at, description, milestone_id')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(100),
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('ball', 'client')
      .neq('status', 'done'),
  ])

  // エラーログ（graceful degradation: 空データで続行）
  if (milestonesResult.error) console.error('[Portal AllTasks] milestones query error:', milestonesResult.error)
  if (tasksResult.error) console.error('[Portal AllTasks] tasks query error:', tasksResult.error)
  if (actionCountResult.error) console.error('[Portal AllTasks] actionCount query error:', actionCountResult.error)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const milestonesFormatted = (milestonesResult.data || []).map((m: any) => ({
    id: m.id,
    name: m.name,
    due_date: m.due_date,
    order_key: m.order_key,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasksFormatted = (tasksResult.data || []).map((task: any) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    ball: task.ball,
    dueDate: task.due_date,
    type: task.type as 'task' | 'spec',
    createdAt: task.created_at,
    milestoneId: task.milestone_id,
  }))

  return (
    <PortalAllTasksClient
      currentProject={currentProject}
      projects={projects}
      tasks={tasksFormatted}
      milestones={milestonesFormatted}
      actionCount={actionCountResult.count || 0}
    />
  )
}
