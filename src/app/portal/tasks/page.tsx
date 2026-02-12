import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalTasksClient } from './PortalTasksClient'

export default async function PortalTasksPage() {
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

  // タスク取得（ball=client, done除外）- memberships取得後に即実行
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: clientTasks } = await (supabase as any)
    .from('tasks')
    .select('id, title, status, ball, due_date, type, decision_state, created_at, description')
    .eq('space_id', spaceId)
    .eq('ball', 'client')
    .neq('status', 'done')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  const now = new Date()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasksWithDetails = (clientTasks || []).map((task: any) => {
    const createdAt = new Date(task.created_at)
    const waitingDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
    const isOverdue = task.due_date ? new Date(task.due_date) < now : false

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      dueDate: task.due_date,
      isOverdue,
      waitingDays,
      type: task.type as 'task' | 'spec',
    }
  })

  // actionCount はタスクリストから直接算出（追加クエリ不要）
  const actionCount = tasksWithDetails.length

  return (
    <PortalTasksClient
      currentProject={currentProject}
      projects={projects}
      tasks={tasksWithDetails}
      actionCount={actionCount}
    />
  )
}
