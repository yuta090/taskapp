import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalMeetingsClient } from './PortalMeetingsClient'

export default async function PortalMeetingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get client's spaces
  const { data: memberships } = await supabase
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

  const projects = memberships.map((m: { space_id: string; spaces?: { name?: string; org_id?: string; organizations?: { name?: string } } }) => ({
    id: m.space_id,
    name: m.spaces?.name || 'プロジェクト',
    orgId: m.spaces?.org_id || '',
    orgName: m.spaces?.organizations?.name || '組織',
  }))

  const currentProject = projects[0]
  const spaceId = currentProject.id

  // meetings と actionCount を並列取得（spaceId 確定後）
  const [meetingsResult, actionCountResult] = await Promise.all([
    supabase
      .from('meetings')
      .select(`
        id,
        title,
        held_at,
        status,
        minutes_md,
        summary_subject,
        summary_body,
        started_at,
        ended_at
      `)
      .eq('space_id', spaceId)
      .in('status', ['ended', 'in_progress'])
      .order('held_at', { ascending: false })
      .limit(50),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('ball', 'client')
      .neq('status', 'done'),
  ])

  // エラーログ（graceful degradation: 空データで続行）
  if (meetingsResult.error) console.error('[Portal Meetings] meetings query error:', meetingsResult.error)
  if (actionCountResult.error) console.error('[Portal Meetings] actionCount query error:', actionCountResult.error)

  const meetings = meetingsResult.data
  const actionCount = actionCountResult.count

  const formattedMeetings = (meetings || []).map((m: { id: string; title: string; held_at: string | null; status: string; minutes_md: string | null; summary_subject: string | null; summary_body: string | null; started_at: string | null; ended_at: string | null }) => ({
    id: m.id,
    title: m.title,
    heldAt: m.held_at || '',
    status: m.status,
    minutesMd: m.minutes_md,
    summarySubject: m.summary_subject,
    summaryBody: m.summary_body,
    startedAt: m.started_at,
    endedAt: m.ended_at,
  }))

  return (
    <PortalMeetingsClient
      currentProject={currentProject}
      projects={projects}
      meetings={formattedMeetings}
      actionCount={actionCount || 0}
    />
  )
}
