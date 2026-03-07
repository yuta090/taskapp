import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalRequestsClient } from './PortalRequestsClient'
import { isPortalSectionEnabled } from '@/lib/portal/checkPortalSection'
import type { SupabaseClient } from '@supabase/supabase-js'

export default async function PortalRequestsPage() {
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

  if (!(await isPortalSectionEnabled(supabase as SupabaseClient, spaceId, 'requests'))) {
    redirect('/portal')
  }

  // Fetch tasks submitted by client (origin='client') and action count in parallel
  const [requestsResult, actionCountResult] = await Promise.all([
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id, title, status, ball, due_date, type, created_at, description')
      .eq('space_id', spaceId)
      .eq('origin', 'client')
      .order('created_at', { ascending: false })
      .limit(100),

    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('ball', 'client')
      .neq('status', 'done'),
  ])

  if (requestsResult.error) console.error('[Portal Requests] query error:', requestsResult.error)
  if (actionCountResult.error) console.error('[Portal Requests] actionCount error:', actionCountResult.error)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests = (requestsResult.data || []).map((task: any) => ({
    id: task.id,
    title: task.title,
    status: task.status as string,
    ball: task.ball as string,
    dueDate: task.due_date as string | null,
    type: task.type as 'task' | 'spec',
    createdAt: task.created_at as string,
    description: task.description as string | null,
  }))

  return (
    <PortalRequestsClient
      currentProject={currentProject}
      projects={projects}
      requests={requests}
      actionCount={actionCountResult.count || 0}
    />
  )
}
