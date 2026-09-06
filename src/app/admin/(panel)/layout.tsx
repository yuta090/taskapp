import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar, COLLAPSED_STORAGE_KEY } from '@/components/admin/AdminSidebar'

export const dynamic = 'force-dynamic'

async function verifySuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await (supabase as SupabaseClient)
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_superadmin) return null

  return user
}

/**
 * サイドバーの件数バッジ（href → 件数）。
 *
 * 「未処理がどこに溜まっているか」をサイドバーだけで判るようにする。特に
 * **共通LINE開通待ち**は収益の律速（承認するまで顧客の製品が動かない）なので、
 * 申込通知メールを見落としても最上段のバッジで気づけるようにしておく。
 *
 * ★必ず superadmin ゲートを通過した後にだけ呼ぶこと（件数も運営専用情報のため）。
 * 件数は head:true の count クエリだけで、行本体は取らない（表示を遅くしない）。
 * ポーリング・リアルタイム購読はしない（ページ遷移ごとの再取得で足りる）。
 */
async function fetchNavBadges(): Promise<Record<string, number>> {
  const admin = createAdminClient()
  const [unread, requested, openReviews] = await Promise.all([
    admin.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
    admin
      .from('org_channel_policy')
      .select('*', { count: 'exact', head: true })
      .eq('shared_bot_access', 'requested'),
    admin.from('reviews').select('*', { count: 'exact', head: true }).eq('status', 'open'),
  ])
  return {
    '/admin/notifications': unread.count ?? 0,
    '/admin/shared-bot-access': requested.count ?? 0,
    '/admin/reviews': openReviews.count ?? 0,
  }
}

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await verifySuperadmin()

  if (!user) {
    redirect('/admin/login')
  }

  const [badges, cookieStore] = await Promise.all([fetchNavBadges(), cookies()])
  // サイドバーの折りたたみは cookie から初回描画に反映する（client 側の記憶と二重持ち・ガタつき防止）
  const initialCollapsed = cookieStore.get(COLLAPSED_STORAGE_KEY)?.value === '1'

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar badges={badges} initialCollapsed={initialCollapsed} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
