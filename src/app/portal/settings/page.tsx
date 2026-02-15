import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalSettingsClient } from './PortalSettingsClient'
import type { SupabaseClient } from '@supabase/supabase-js'

export default async function PortalSettingsPage() {
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

  // profile と actionCount を並列取得
  const [profileResult, actionCountResult] = await Promise.all([
     
    (supabase as SupabaseClient)
      .from('profiles')
      .select('id, display_name, email, avatar_url')
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
      }}
      actionCount={actionCountResult.count || 0}
    />
  )
}
