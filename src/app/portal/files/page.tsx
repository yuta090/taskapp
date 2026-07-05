import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalFilesClient } from './PortalFilesClient'
import { isPortalSectionEnabled } from '@/lib/portal/checkPortalSection'
import { getClientProjects, resolveCurrentProject } from '@/lib/portal/getClientProjects'
import type { SupabaseClient } from '@supabase/supabase-js'

interface PageProps {
  searchParams: Promise<{ space?: string | string[] }>
}

export default async function PortalFilesPage({ searchParams }: PageProps) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get client's projects, resolved against ?space=
  const { space } = await searchParams
  const projects = await getClientProjects(supabase as SupabaseClient, user.id)
  const currentProject = resolveCurrentProject(projects, space)

  if (!currentProject) {
    return (
      <div className="min-h-screen bg-[#F7F7F5] flex items-center justify-center">
        <div className="text-center bg-white rounded-xl border border-gray-200 shadow-sm p-8 max-w-md">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">アクセス権限がありません</h1>
          <p className="text-gray-600">招待リンクからアクセスしてください</p>
        </div>
      </div>
    )
  }

  const spaceId = currentProject.id

  if (!(await isPortalSectionEnabled(supabase as SupabaseClient, spaceId, 'files'))) {
    redirect('/portal')
  }

  // Get files (placeholder - would need a files table)
  const files: { id: string; name: string; type: string; size: number; createdAt: string }[] = []

  // Get action count for sidebar badge
   
  const { count: actionCount } = await (supabase as SupabaseClient)
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('space_id', spaceId)
    .eq('ball', 'client')
    .neq('status', 'done')

  return (
    <PortalFilesClient
      currentProject={currentProject}
      projects={projects}
      files={files}
      actionCount={actionCount || 0}
    />
  )
}
