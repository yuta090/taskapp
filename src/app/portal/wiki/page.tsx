import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalWikiClient } from './PortalWikiClient'
import type { SupabaseClient } from '@supabase/supabase-js'

export default async function PortalWikiPage() {
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
  const clientSpaceIds = projects.map((p: { id: string }) => p.id)

  // wikiPages と actionCount を並列取得
  const [wikiResult, actionCountResult] = await Promise.all([
     
    (supabase as SupabaseClient)
      .from('wiki_page_publications')
      .select(`
        id,
        org_id,
        published_title,
        published_body,
        published_at,
        source_page_id,
        wiki_pages!inner ( space_id ),
        milestone_publications!inner ( is_published )
      `)
      .eq('org_id', currentProject.orgId)
      .eq('milestone_publications.is_published', true)
      .in('wiki_pages.space_id', clientSpaceIds)
      .order('published_at', { ascending: false }),
     
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', currentProject.id)
      .eq('ball', 'client')
      .neq('status', 'done'),
  ])

  // エラーログ（graceful degradation: 空データで続行）
  if (wikiResult.error) console.error('[Portal Wiki] wiki query error:', wikiResult.error)
  if (actionCountResult.error) console.error('[Portal Wiki] actionCount query error:', actionCountResult.error)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serializedPages = (wikiResult.data || []).map((p: any) => ({
    id: p.id,
    title: p.published_title,
    body: p.published_body,
    publishedAt: p.published_at,
  }))

  return (
    <PortalWikiClient
      currentProject={currentProject}
      projects={projects}
      wikiPages={serializedPages}
      actionCount={actionCountResult.count || 0}
    />
  )
}
