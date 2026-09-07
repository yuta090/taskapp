import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar, COLLAPSED_STORAGE_KEY } from '@/components/admin/AdminSidebar'
import { MFA_CHALLENGE_PATH } from '@/lib/auth/mfa'
import { verifySuperadminDetailed } from '@/lib/admin/verify-superadmin'

export const dynamic = 'force-dynamic'

/**
 * 二要素認証の強制設定の自己チェック。pre-request はロール設定（pg_dump に含まれない）で、
 * リストア・ブランチ・ロール再設定で黙って消えうる。消えていたら運営画面に赤い帯を出す。
 * 取得に失敗したら null（帯は出さない。ログのみ）
 */
async function fetchMfaEnforcementStatus(): Promise<{ preRequest: boolean; policyMissing: string[] } | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('mfa_enforcement_status')
    if (error || !data) return null
    const d = data as { pre_request?: boolean; policy_missing?: string[] }
    return { preRequest: d.pre_request === true, policyMissing: Array.isArray(d.policy_missing) ? d.policy_missing : [] }
  } catch (err) {
    console.error('[admin] mfa_enforcement_status failed', err)
    return null
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
  // 門番は API と同じ verifySuperadminDetailed（superadmin かつ二要素認証の条件）。
  // 登録済み×コード未入力 → コード入力画面、ADMIN_MFA_REQUIRED=true で未登録 → 設定画面へ案内、
  // 判定できない（check_failed）→ 締め出し（fail-closed）
  const verdict = await verifySuperadminDetailed()
  if (!verdict.ok) {
    if (verdict.reason === 'mfa_required') {
      redirect(`${MFA_CHALLENGE_PATH}?redirect=${encodeURIComponent('/admin/dashboard')}`)
    }
    if (verdict.reason === 'mfa_not_enrolled') {
      redirect('/settings/account?mfa=required')
    }
    redirect('/admin/login')
  }

  const [badges, cookieStore, enforcement] = await Promise.all([fetchNavBadges(), cookies(), fetchMfaEnforcementStatus()])
  // サイドバーの折りたたみは cookie から初回描画に反映する（client 側の記憶と二重持ち・ガタつき防止）
  const initialCollapsed = cookieStore.get(COLLAPSED_STORAGE_KEY)?.value === '1'

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar badges={badges} initialCollapsed={initialCollapsed} />
      <main className="flex-1 overflow-y-auto">
        {enforcement && (!enforcement.preRequest || enforcement.policyMissing.length > 0) && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-800" role="alert">
            ⚠ 二要素認証の強制設定が外れています（
            {!enforcement.preRequest && 'PostgREST の pre-request 設定なし'}
            {!enforcement.preRequest && enforcement.policyMissing.length > 0 && '・'}
            {enforcement.policyMissing.length > 0 && `ポリシー未設定: ${enforcement.policyMissing.join(', ')}`}
            ）。docs/ops/MFA.md の手順で復旧してください。
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
