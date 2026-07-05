import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolvePostLoginLandingOptions {
  /** ACTIVE_ORG_COOKIE 等、切替中のorgを優先着地させたい場合に指定（非所属なら無視） */
  preferredOrgId?: string | null
}

/**
 * ログイン後（パスワードログイン / デモログイン / Googleログイン）の着地先を一元的に決定する。
 * LoginClient と auth/callback で個別に実装されていた判定ロジックをここに集約する。
 *
 * 判定順:
 * 1. org_memberships が0件 → /onboarding（サインアップ後にオンボーディング未完了のままログインし直した等）
 * 2. preferredOrgId が所属org内にあればそれを採用、無ければ created_at 昇順の先頭を採用
 * 3. role が client → 同org内で vendor の space 所属があれば /vendor-portal、無ければ /portal
 * 4. それ以外（内部ロール）→ 同org内の type='project' な space を created_at 昇順で1件取得し、
 *    あれば `/${orgId}/project/${spaceId}`、無ければ /onboarding（作成途中で離脱したケース）
 */
export async function resolvePostLoginLanding(
  supabase: SupabaseClient,
  userId: string,
  opts: ResolvePostLoginLandingOptions = {}
): Promise<string> {
  const { data: memberships, error } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  // membershipクエリエラー → 呼び出し元でfail-closed（ログインページ等へ誘導）させる
  if (error) {
    throw new Error(`resolvePostLoginLanding: org_memberships query failed: ${error.message}`)
  }

  if (!memberships || memberships.length === 0) {
    return '/onboarding'
  }

  const preferredOrgId = opts.preferredOrgId
  const membership =
    (preferredOrgId && memberships.find((m) => m.org_id === preferredOrgId)) || memberships[0]

  if (membership.role === 'client') {
    // 同org内でvendorのspaceに所属していれば/vendor-portalへ（ベンダーのGoogleログインが
    // /portalの「アクセス権限がありません」で行き止まりにならないようにする）
    const { data: vendorMem } = await supabase
      .from('space_memberships')
      .select('id, spaces!inner(org_id)')
      .eq('user_id', userId)
      .eq('role', 'vendor')
      .eq('spaces.org_id', membership.org_id)
      .limit(1)
      .maybeSingle()
    if (vendorMem) return '/vendor-portal'
    return '/portal'
  }

  const { data: space } = await supabase
    .from('spaces')
    .select('id')
    .eq('org_id', membership.org_id)
    .eq('type', 'project')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  if (space) return `/${membership.org_id}/project/${space.id}`

  // 組織はあるがプロジェクトが無い（作成途中で離脱）→ オンボーディングのStep2から再開
  return '/onboarding'
}
