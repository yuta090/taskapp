import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalMeetingsClient } from './PortalMeetingsClient'
import { isPortalSectionEnabled } from '@/lib/portal/checkPortalSection'
import { getClientProjects, resolveCurrentProject } from '@/lib/portal/getClientProjects'
import { fetchPortalMeetingsData } from '@/lib/portal/fetchPortalMeetingsData'
import type { SupabaseClient } from '@supabase/supabase-js'

interface PageProps {
  searchParams: Promise<{ space?: string | string[] }>
}

export default async function PortalMeetingsPage({ searchParams }: PageProps) {
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
        <div className="text-center bg-surface rounded-xl border border-gray-200 shadow-sm p-8 max-w-md">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">アクセス権限がありません</h1>
          <p className="text-gray-600">招待リンクからアクセスしてください</p>
        </div>
      </div>
    )
  }

  const spaceId = currentProject.id

  if (!(await isPortalSectionEnabled(supabase as SupabaseClient, spaceId, 'meetings'))) {
    redirect('/portal')
  }

  // meetings は全件を range ページングで読み切る（社内一覧と同じ collectRemainingPages）。
  // 失敗時は空データ/読めたページまでで続行する graceful degradation を守るため、
  // 例外を投げない fetchPortalMeetingsData に処理を委ねる。
  const { meetings: formattedMeetings, actionCount } = await fetchPortalMeetingsData(
    supabase as SupabaseClient,
    spaceId
  )

  return (
    <PortalMeetingsClient
      currentProject={currentProject}
      projects={projects}
      meetings={formattedMeetings}
      actionCount={actionCount}
    />
  )
}
