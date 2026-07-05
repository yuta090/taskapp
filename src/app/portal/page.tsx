import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalDashboardClient } from './PortalDashboardClient'
import { fetchPortalDashboardData } from '@/lib/portal/fetchPortalDashboardData'
import { getClientProjects, resolveCurrentProject } from '@/lib/portal/getClientProjects'
import type { SupabaseClient } from '@supabase/supabase-js'

// AT-010: Client dashboard with bento grid layout
// - Modern dashboard with progress ring, milestones, activities
// - ball=client tasks appear first (considering, pending review)
// - Sorted by due_date ASC (null last)

interface PageProps {
  searchParams: Promise<{ space?: string | string[] }>
}

export default async function PortalDashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // クライアントが所属する全プロジェクトを取得し、?space= で選択されたものを解決する
  const { space } = await searchParams
  const projects = await getClientProjects(supabase as SupabaseClient, user.id)
  const currentProject = resolveCurrentProject(projects, space)

  if (!currentProject) {
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

  const spaceId = currentProject.id

  const dashboardData = await fetchPortalDashboardData(supabase as SupabaseClient, spaceId)

  return (
    <PortalDashboardClient
      currentProject={currentProject}
      projects={projects}
      dashboardData={dashboardData}
    />
  )
}
