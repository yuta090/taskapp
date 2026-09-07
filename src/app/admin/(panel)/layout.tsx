import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar, COLLAPSED_STORAGE_KEY } from '@/components/admin/AdminSidebar'
import { needsMfaChallenge, MFA_CHALLENGE_PATH } from '@/lib/auth/mfa'

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

/** 運営画面の二要素認証ゲート（判定は純粋関数 needsMfaChallenge） */
async function enforceAdminMfa() {
  const supabase = await createClient()
  let current: 'aal1' | 'aal2' | null = null
  let next: 'aal1' | 'aal2' | null = null
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    current = aal?.currentLevel ?? null
    next = aal?.nextLevel ?? null
  } catch (err) {
    // 判定できないときは締め出さない（主の門番は src/proxy.ts。ここは二重チェック）
    console.error('[admin] mfa level check failed', err)
    return
  }
  if (needsMfaChallenge(current, next)) {
    // 元のページは持ち回らずダッシュボードへ戻す（layout からは現在パスを安全に取れないため）
    redirect(`${MFA_CHALLENGE_PATH}?redirect=${encodeURIComponent('/admin/dashboard')}`)
  }
  if (process.env.ADMIN_MFA_REQUIRED === 'true' && next !== 'aal2') {
    // 未登録: 設定画面で登録してもらう（登録すると次回から通れる）
    redirect('/settings/account?mfa=required')
  }
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

  // 二要素認証: 運営画面は最も影響の大きい面なので、登録済みならコード入力(aal2)を必須にする。
  // ADMIN_MFA_REQUIRED=true のときは未登録の運営も入れない（設定画面へ案内）。
  // 通常の保護ページの門番(src/proxy.ts)でも同じ判定をしているが、ここは念のための二重チェック
  await enforceAdminMfa()

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
