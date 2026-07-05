import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalDashboardClient } from './PortalDashboardClient'
import { fetchPortalDashboardData } from '@/lib/portal/fetchPortalDashboardData'
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
          <h1 className="text-xl font-semibold text-gray-900 mb-2">アクセス権限がありません</h1>
          <p className="text-gray-600">招待リンクからアクセスしてください</p>
        </div>
      </div>
    )
  }

  const spaceId = membership.space_id
  const spaceName = (membership.spaces as { name?: string })?.name || 'プロジェクト'
  const orgId = (membership.spaces as { org_id?: string })?.org_id || ''

  const dashboardData = await fetchPortalDashboardData(supabase as SupabaseClient, spaceId)

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
