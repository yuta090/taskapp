import { NextRequest, NextResponse } from 'next/server'
import { mfaRedirectResponse } from '@/lib/auth/apiMfaGuard'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getInstallationRepositories, getInstallationPermissions } from '@/lib/github'
import { verifySignedState } from '@/lib/github/config'
import { isSafeInternalPath } from '@/lib/auth/safeRedirect'
import {
  exchangeCodeForUserToken,
  findUserInstallation,
  getAuthenticatedGitHubUser,
  isOrgAdmin,
  revokeUserToken,
  type GitHubUserInstallation,
} from '@/lib/github/userAuth'
import { isOrgOwner } from '@/lib/github/orgOwner'

export const runtime = 'nodejs'

// state は署名済みで通常はサイト内パスしか入らないが、戻り先の検査は
// isSafeInternalPath 一か所に揃えるため、ここでも改めて確認する。
const DEFAULT_REDIRECT = '/settings/org-integrations'

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
 *
 * 保存する前に、次の順で「GitHub 側で利用者本人がこのインストールの持ち主であること」を
 * 確認する。途中で条件を満たさなければ何も保存せずエラーで戻す:
 *   1. state の署名・期限・利用者 ID（sub）を検証
 *   2. ログイン確認
 *   3. 二要素認証
 *   4. ログイン中の利用者と state の利用者 ID が一致するか
 *   5. その組織の owner か
 *   6. code（GitHub App の「Request user authorization」で付与される）があるか
 *   7. code を user-to-server トークンに交換
 *   8. そのトークンで GET /user/installations を引き、installation_id が含まれるか。
 *      含まれていても「一覧に載る」だけでは持ち主とは限らないため、さらに
 *      個人アカウントならログイン中の GitHub アカウントと同じ ID か、
 *      組織アカウントならその組織の管理者（admin）かを確認する
 *   9. 確認済みのトークンは破棄する
 *   10. 既存の紐づけが別の組織であれば付け替えない
 *   11. 保存
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const installationId = searchParams.get('installation_id')
  const state = searchParams.get('state')
  const code = searchParams.get('code')
  const setupActionRaw = searchParams.get('setup_action')
  const setupAction = setupActionRaw === 'install' || setupActionRaw === 'update' ? setupActionRaw : 'other'

  // 値は出さず、何が付いていたかだけを記録する
  console.info('[github/callback] received', {
    has_installation_id: !!installationId,
    has_state: !!state,
    has_code: !!code,
    setup_action: setupAction,
  })

  if (!installationId) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=missing_installation_id', request.url)
    )
  }
  const installationIdNum = parseInt(installationId, 10)

  // 1. state の署名・期限・利用者 ID（sub）を検証して orgId と redirectUri を取得
  let orgId: string | null = null
  let stateUserId: string | null = null
  let redirectUri = '/settings/integrations/github'

  if (state) {
    const verified = verifySignedState(state)
    if (verified) {
      orgId = verified.orgId
      stateUserId = verified.userId
      redirectUri = isSafeInternalPath(verified.redirectUri) ? verified.redirectUri : DEFAULT_REDIRECT
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

  // 2. ログイン確認。保存の「作成者」はログイン中のユーザー。
  // created_by は auth.users への外部キーなので、仮の ID を入れると insert が必ず失敗する
  // （GitHub 側は入っているのに AgentPM に残らない、という回帰の原因）。
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=unauthorized`, request.url)
    )
  }

  // 3. 二要素認証: 登録済み × コード未入力(aal1) は連携を紐付けさせず、コード入力画面へ
  const mfaBlock = await mfaRedirectResponse(supabase as SupabaseClient, user, new URL(request.url).origin, '/settings/org-integrations')
  if (mfaBlock) return mfaBlock

  // 4. インストールを始めたのと同じ利用者かどうか
  if (user.id !== stateUserId) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=state_mismatch`, request.url)
    )
  }

  // 5. その組織の owner か（authorize と同じ判定関数を共用）
  if (!(await isOrgOwner(supabase as SupabaseClient, orgId, user.id))) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=forbidden`, request.url)
    )
  }

  // 6. GitHub App の「Request user authorization (OAuth) during installation」により
  // 付与される code。新規インストール・既存インストールの更新のどちらでも必須にする
  if (!code) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=oauth_required`, request.url)
    )
  }

  // 7. code を user-to-server トークンに交換
  const userToken = await exchangeCodeForUserToken(code)
  if (!userToken) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=oauth_failed`, request.url)
    )
  }

  // 8. そのトークンで、利用者本人がこのインストールの持ち主であることを確認する。
  // 一覧（GET /user/installations）に載るのは「アクセスできる」というだけで持ち主とは
  // 限らないため、個人アカウントならログイン中の GitHub アカウントと同じ ID か、
  // 組織アカウントならその組織の管理者（admin）かをさらに確認する
  let matchedInstallation: GitHubUserInstallation | null = null
  let isOwner = false
  try {
    try {
      matchedInstallation = await findUserInstallation(userToken, installationIdNum)
      if (matchedInstallation) {
        const { type, login } = matchedInstallation.account
        if (type === 'User') {
          const authedUser = await getAuthenticatedGitHubUser(userToken)
          if (!authedUser) {
            // 「持ち主ではない」ではなく、GitHub 側から一時的に取得できなかった扱いにする
            throw new Error('Failed to fetch authenticated GitHub user for ownership check')
          }
          isOwner = authedUser.id === matchedInstallation.account.id
        } else if (type === 'Organization' && typeof login === 'string' && login.length > 0) {
          isOwner = await isOrgAdmin(userToken, login)
        } else {
          // 想定外の account.type（例: Enterprise）は持ち主として扱わない
          isOwner = false
        }
      }
    } finally {
      // 9. 確認が済んだトークンは残さない（失敗してもログのみ・処理は止めない）
      try {
        await revokeUserToken(userToken)
      } catch (revokeErr) {
        console.error('Failed to revoke GitHub user token:', revokeErr)
      }
    }
  } catch (err) {
    console.error('Failed to verify GitHub installation ownership:', err)
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=api_error`, request.url)
    )
  }

  if (!matchedInstallation) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=installation_not_accessible`, request.url)
    )
  }

  if (!isOwner) {
    return NextResponse.redirect(
      new URL(`${redirectUri}?error=installation_not_owned`, request.url)
    )
  }

  try {
    // 10. 既存の紐づけが別の組織であれば付け替えない
    // （installation_id は組織をまたいで一意。webhook が installation_id から組織を
    //   1つに逆引きしているため、1インストール = 1組織を保つ）
    // 行が無いのは正常（新規インストール）なので maybeSingle を使う。DB エラーはここで
    // 打ち切り、App の資格情報でのリポジトリ取得（getInstallationRepositories 以降）には進まない
    const { data: existingInstall, error: existingInstallError } = await getSupabaseAdmin()
      .from('github_installations')
      .select('id, org_id')
      .eq('installation_id', installationIdNum)
      .maybeSingle()

    if (existingInstallError) {
      console.error('Failed to look up existing GitHub installation:', existingInstallError)
      return NextResponse.redirect(
        new URL(`${redirectUri}?error=api_error`, request.url)
      )
    }

    if (existingInstall && existingInstall.org_id !== orgId) {
      return NextResponse.redirect(
        new URL(`${redirectUri}?error=already_linked`, request.url)
      )
    }

    // 11. 保存
    // GitHub API からインストール情報を取得
    const repositories = await getInstallationRepositories(installationIdNum)

    if (repositories.length === 0) {
      return NextResponse.redirect(
        new URL(`${redirectUri}?error=no_repositories`, request.url)
      )
    }

    // アカウント情報は、手順8で確認済みのインストール項目から取る
    // （firstRepo.owner ではなく、持ち主確認に使った account をそのまま使う）
    const accountLogin = matchedInstallation.account.login
    const accountType = matchedInstallation.account.type as 'Organization' | 'User'

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
          installation_id: installationIdNum,
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
      const permissions = await getInstallationPermissions(installationIdNum)
      if (permissions) {
        const { error: permissionsError } = await getSupabaseAdmin()
          .from('github_installations')
          .update({
            permissions,
            permissions_updated_at: new Date().toISOString(),
          })
          .eq('org_id', orgId)
          .eq('installation_id', installationIdNum)

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
      installation_id: installationIdNum,
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
