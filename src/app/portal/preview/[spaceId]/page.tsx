import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalDashboardClient } from '@/app/portal/PortalDashboardClient'
import { fetchPortalDashboardData } from '@/lib/portal/fetchPortalDashboardData'
import { PortalPreviewSeenMarker } from './PortalPreviewSeenMarker'
import type { SupabaseClient } from '@supabase/supabase-js'

interface PageProps {
  params: Promise<{ spaceId: string }>
}

/**
 * 内部ユーザー向け「クライアント表示プレビュー」— 実際のクライアントポータル
 * ダッシュボード(`/portal`)と全く同じ集計・見た目を、クライアント招待前でも
 * 確認できる読み取り専用画面。データ取得は fetchPortalDashboardData に単一化
 * しているため、本物のポータルと集計ロジックが乖離することはない。
 *
 * 認可: ログイン必須。対象 space の org に対し role != 'client' の
 * org_memberships を持つ内部ユーザーのみ許可。
 *   - クライアントロール -> 本物のポータルへ redirect（プレビューは不要）
 *   - 非メンバー -> notFound()（space-id の総当たり探索を防ぐ）
 */
export default async function PortalPreviewPage({ params }: PageProps) {
  const { spaceId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: space, error: spaceError } = await (supabase as SupabaseClient)
    .from('spaces')
    .select('id, name, org_id')
    .eq('id', spaceId)
    .single()

  if (spaceError || !space) {
    notFound()
  }

  const { data: membership } = await (supabase as SupabaseClient)
    .from('org_memberships')
    .select('role')
    .eq('org_id', space.org_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    // 非メンバー: space-id の総当たり探索を防ぐため notFound で返す
    notFound()
  }

  if (membership.role === 'client') {
    // クライアント本人には本物のポータルがある
    redirect('/portal')
  }

  const dashboardData = await fetchPortalDashboardData(supabase as SupabaseClient, spaceId)

  const currentProject = {
    id: space.id as string,
    name: (space.name as string) || 'プロジェクト',
    orgId: space.org_id as string,
  }

  return (
    <>
      <PortalPreviewSeenMarker />
      <PortalDashboardClient
        currentProject={currentProject}
        projects={[currentProject]}
        dashboardData={dashboardData}
        previewMode
      />
    </>
  )
}
