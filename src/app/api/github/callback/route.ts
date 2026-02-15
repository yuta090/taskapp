import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getInstallationRepositories } from '@/lib/github'
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
      // システムユーザーとして作成（created_by は後で更新可能）
      // 注: 実際には認証されたユーザーのIDを使用すべき
      const { error: installError } = await getSupabaseAdmin()
        .from('github_installations')
        .insert({
          org_id: orgId,
          installation_id: parseInt(installationId, 10),
          account_login: accountLogin,
          account_type: accountType,
          created_by: '00000000-0000-0000-0000-000000000000', // システムユーザー（要修正）
        })

      if (installError) {
        console.error('Failed to save installation:', installError)
        return NextResponse.redirect(
          new URL(`${redirectUri}?error=save_failed`, request.url)
        )
      }
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
