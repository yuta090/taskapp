import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VendorDashboardClient } from './VendorDashboardClient'

export default async function VendorPortalDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // ベンダーとしてのスペースメンバーシップを取得
  const { data: membership } = await (supabase as SupabaseClient)
    .from('space_memberships')
    .select(`
      space_id,
      spaces!inner (
        id,
        name,
        org_id,
        agency_mode
      )
    `)
    .eq('user_id', user.id)
    .eq('role', 'vendor')
    .limit(1)
    .single()

  if (!membership) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">アクセス権限がありません</h1>
          <p className="text-gray-600">ベンダーとして招待されていません。招待リンクからアクセスしてください。</p>
        </div>
      </div>
    )
  }

  const spaceId = membership.space_id
  const space = membership.spaces as unknown as { id: string; name: string; org_id: string; agency_mode: boolean }

  if (!space.agency_mode) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">ベンダーポータルは無効です</h1>
          <p className="text-gray-600">このプロジェクトでは代理店モードが有効になっていません。</p>
        </div>
      </div>
    )
  }

  // タスク統計を取得
  const [ballVendorResult, ballAgencyResult, totalResult] = await Promise.all([
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('ball', 'vendor')
      .neq('status', 'done'),
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('ball', 'agency')
      .neq('status', 'done'),
    (supabase as SupabaseClient)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .neq('status', 'done'),
  ])

  return (
    <VendorDashboardClient
      spaceId={spaceId}
      spaceName={space.name}
      orgId={space.org_id}
      stats={{
        vendorBall: ballVendorResult.count ?? 0,
        agencyBall: ballAgencyResult.count ?? 0,
        total: totalResult.count ?? 0,
      }}
    />
  )
}
