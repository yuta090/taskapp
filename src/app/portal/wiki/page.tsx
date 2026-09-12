import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalWikiClient } from './PortalWikiClient'
import { isPortalSectionEnabled } from '@/lib/portal/checkPortalSection'
import { getClientProjects, resolveCurrentProject } from '@/lib/portal/getClientProjects'
import type { SupabaseClient } from '@supabase/supabase-js'

interface PageProps {
  searchParams: Promise<{ space?: string | string[] }>
}

export default async function PortalWikiPage({ searchParams }: PageProps) {
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

  const clientSpaceIds = projects.map((p) => p.id)

  // isPortalSectionEnabled・milestone_publications・actionCountは互いに依存しない
  // ので並べて読む(セクションが無効なときは問い合わせが2本無駄になるが、稀な経路
  // なので許容する)。wiki_page_publicationsとmilestone_publicationsの間には外部
  // キーが無い(どちらもmilestones/organizationsを指すだけ)ため、埋め込みでは
  // 絞れない。先に公開中のマイルストーンIDを引いてから、それでwiki_page_publications
  // 側を絞る
  const [sectionEnabled, milestonePubsResult, actionCountResult] = await Promise.all([
    isPortalSectionEnabled(supabase as SupabaseClient, currentProject.id, 'wiki'),

    (supabase as SupabaseClient)
      .from('milestone_publications')
      .select('milestone_id')
      .eq('org_id', currentProject.orgId)
      .eq('is_published', true),

    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', currentProject.id)
      .eq('ball', 'client')
      .neq('status', 'done'),
  ])

  if (!sectionEnabled) {
    redirect('/portal')
  }

  // エラーログ（graceful degradation: 空データで続行）
  if (milestonePubsResult.error) console.error('[Portal Wiki] milestone_publications query error:', milestonePubsResult.error)
  if (actionCountResult.error) console.error('[Portal Wiki] actionCount query error:', actionCountResult.error)

  const publishedMilestoneIds = (milestonePubsResult.data || []).map((m) => m.milestone_id)

  const wikiResult = publishedMilestoneIds.length === 0
    ? { data: [] as unknown[], error: null }
    : await (supabase as SupabaseClient)
        .from('wiki_page_publications')
        .select(`
          id,
          org_id,
          published_title,
          published_body,
          published_at,
          source_page_id,
          wiki_pages!inner ( space_id )
        `)
        .eq('org_id', currentProject.orgId)
        // 未公開のマイルストーンのWikiを止めているのはこの絞り込み自体(RLSではない)。
        // 社内の人がこのページを開いた場合にも未公開が漏れないよう、意図して残す
        .in('milestone_id', publishedMilestoneIds)
        .in('wiki_pages.space_id', clientSpaceIds)
        .order('published_at', { ascending: false })

  if (wikiResult.error) console.error('[Portal Wiki] wiki query error:', wikiResult.error)

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
