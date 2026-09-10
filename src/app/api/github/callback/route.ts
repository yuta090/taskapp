import { NextRequest, NextResponse } from 'next/server'
import { mfaRedirectResponse } from '@/lib/auth/apiMfaGuard'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getInstallationRepositories, getInstallationPermissions } from '@/lib/github'
import { verifySignedState } from '@/lib/github/config'

export const runtime = 'nodejs'

// Untyped client — github_installations/github_repositories are not in Database types
let _supabaseAdmin: SupabaseClient | null = null
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

/**
 * GitHub App インストール後のコールバック
 * GitHub からリダイレクトされてくる
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const installationId = searchParams.get('installation_id')
  const state = searchParams.get('state')

  if (!installationId) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=missing_installation_id', request.url)
    )
  }

  // state の署名を検証して orgId と redirectUri を取得
  let orgId: string | null = null
  let redirectUri = '/settings/integrations/github'

  if (state) {
    const verified = verifySignedState(state)
    if (verified) {
      orgId = verified.orgId
      redirectUri = verified.redirectUri || redirectUri
    } else {
      console.error('Invalid or expired OAuth state')
      return NextResponse.redirect(
        new URL('/settings/integrations?error=invalid_state', request.url)
      )
    }
  }

  if (!orgId) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=missing_org_id', request.url)
    )
  }

  // 保存の「作成者」はログイン中のユーザー。
  // created_by は auth.users への外部キーなので、仮の ID を入れると insert が必ず失敗する
  // （GitHub 側は入っているのに AgentPM に残らない、という回帰の原因）。
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=unauthorized`, request.url)
    )
  }
  // 二要素認証: 登録済み × コード未入力(aal1) は連携を紐付けさせず、コード入力画面へ
  const mfaBlock = await mfaRedirectResponse(supabase as SupabaseClient, user, new URL(request.url).origin, '/settings/org-integrations')
  if (mfaBlock) return mfaBlock

  try {
    // GitHub API からインストール情報を取得
    const repositories = await getInstallationRepositories(parseInt(installationId, 10))

    if (repositories.length === 0) {
      return NextResponse.redirect(
        new URL(`${redirectUri}?error=no_repositories`, request.url)
      )
    }

    // アカウント情報を取得（最初のリポジトリから）
    const firstRepo = repositories[0]
    const accountLogin = firstRepo.owner.login
    const accountType = firstRepo.owner.type as 'Organization' | 'User'

    // 既存のインストールを確認
    const { data: existingInstall } = await getSupabaseAdmin()
      .from('github_installations')
      .select('id')
      .eq('org_id', orgId)
      .eq('installation_id', parseInt(installationId, 10))
      .single()

    if (existingInstall) {
      // 更新
      await getSupabaseAdmin()
        .from('github_installations')
        .update({
          account_login: accountLogin,
          account_type: accountType,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingInstall.id)
    } else {
      const { error: installError } = await getSupabaseAdmin()
        .from('github_installations')
        .insert({
          org_id: orgId,
          installation_id: parseInt(installationId, 10),
          account_login: accountLogin,
          account_type: accountType,
          created_by: user.id,
        })

      if (installError) {
        console.error('Failed to save installation:', installError)
        return NextResponse.redirect(
          new URL(`${redirectUri}?error=save_failed`, request.url)
        )
      }
    }

    // その時点の許可範囲を記録する（GITHUB_ISSUES_LINK_SPEC.md §5・§7.6）。
    // permissions / permissions_updated_at 列は本番マイグレーション適用前にこのコードが
    // 先に出ても壊れないよう、失敗してもログのみでインストール自体は止めない。
    try {
      const permissions = await getInstallationPermissions(parseInt(installationId, 10))
      if (permissions) {
        const { error: permissionsError } = await getSupabaseAdmin()
          .from('github_installations')
          .update({
            permissions,
            permissions_updated_at: new Date().toISOString(),
          })
          .eq('org_id', orgId)
          .eq('installation_id', parseInt(installationId, 10))

        if (permissionsError) {
          console.error('Failed to save installation permissions:', permissionsError)
        }
      }
    } catch (permErr) {
      console.error('Failed to fetch installation permissions:', permErr)
    }

    // リポジトリ情報を保存
    const repoRecords = repositories.map(repo => ({
      org_id: orgId,
      installation_id: parseInt(installationId, 10),
      repo_id: repo.id,
      owner_login: repo.owner.login,
      repo_name: repo.name,
      default_branch: repo.default_branch || 'main',
      is_private: repo.private,
    }))

    const { error: repoError } = await getSupabaseAdmin()
      .from('github_repositories')
      .upsert(repoRecords, { onConflict: 'org_id,repo_id' })

    if (repoError) {
      console.error('Failed to save repositories:', repoError)
    }

    // 成功時はリダイレクト
    return NextResponse.redirect(
      new URL(`${redirectUri}?success=true&repos=${repositories.length}`, request.url)
    )
  } catch (err) {
    console.error('GitHub callback error:', err)
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=api_error`, request.url)
    )
  }
}
