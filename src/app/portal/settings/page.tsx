import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalSettingsClient } from './PortalSettingsClient'
import { getClientProjects, resolveCurrentProject } from '@/lib/portal/getClientProjects'
import type { SupabaseClient } from '@supabase/supabase-js'

interface PageProps {
  searchParams: Promise<{ space?: string | string[] }>
}

export default async function PortalSettingsPage({ searchParams }: PageProps) {
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

  // profile と actionCount を並列取得
  const [profileResult, actionCountResult] = await Promise.all([
     
    (supabase as SupabaseClient)
      .from('profiles')
      // profiles に email 列は無い（select に含めるとクエリ全体が失敗し profile が null になる）
      .select('id, display_name, avatar_url, reminder_emails_enabled')
      .eq('id', user.id)
      .single(),
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('ball', 'client')
      .neq('status', 'done'),
  ])

  // エラーログ（graceful degradation: フォールバック値で続行）
  if (profileResult.error) console.error('[Portal Settings] profile query error:', profileResult.error)
  if (actionCountResult.error) console.error('[Portal Settings] actionCount query error:', actionCountResult.error)

  const profile = profileResult.data

  return (
    <PortalSettingsClient
      currentProject={currentProject}
      projects={projects}
      user={{
        id: user.id,
        email: user.email || '',
        displayName: profile?.display_name || user.email?.split('@')[0] || '',
        avatarUrl: profile?.avatar_url,
        reminderEmailsEnabled: profile?.reminder_emails_enabled !== false,
      }}
      actionCount={actionCountResult.count || 0}
    />
  )
}
