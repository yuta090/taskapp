import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * リポジトリの追加・解除は GitHub を接続した本人だけができる。
 * github_installations は RLS で created_by = 自分 の行しか返らないため、ログイン中の
 * 本人のセッションで読んで 0 行なら本人ではないと判定できる。
 *
 * 1つの組織に複数の接続がありうる（過去の再接続の残り等）ため `.maybeSingle()`
 * （複数行だとエラーになる）ではなく `.limit(1)` ＋行数で見る。
 *
 * 問い合わせ自体が失敗したとき（DBの一時障害等）は、本人ではない(403)と区別して null を
 * 返さず、呼び出し側で 500 を返せるようにエラーをそのまま持ち帰る。
 */
async function checkGithubConnectorAccess(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const { data: installations, error } = await supabase
    .from('github_installations')
    .select('id')
    .eq('org_id', orgId)
    .limit(1)

  if (error) {
    console.error('Failed to check GitHub installation ownership:', error)
    return {
      ok: false,
      response: NextResponse.json({ error: '接続状態の確認に失敗しました' }, { status: 500 }),
    }
  }

  if (!installations || installations.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'GitHub を接続した人だけが操作できます' },
        { status: 403 }
      ),
    }
  }

  return { ok: true }
}

/**
 * Spaceの連携リポジトリ一覧を取得
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const searchParams = request.nextUrl.searchParams
  const spaceId = searchParams.get('spaceId')

  if (!spaceId) {
    return NextResponse.json(
      { error: 'Missing spaceId parameter' },
      { status: 400 }
    )
  }

  // 認証確認
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Spaceメンバーシップ確認
  const { data: membership } = await supabase
    .from('space_memberships')
    .select('role')
    .eq('space_id', spaceId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json(
      { error: 'Not a member of this space' },
      { status: 403 }
    )
  }

  // Space連携リポジトリ取得
  const { data: linkedRepos, error } = await supabase
    .from('space_github_repos')
    .select(`
      id,
      sync_prs,
      sync_commits,
      created_at,
      github_repositories (
        id,
        repo_id,
        owner_login,
        repo_name,
        full_name,
        default_branch,
        is_private
      )
    `)
    .eq('space_id', spaceId)

  if (error) {
    console.error('Failed to fetch space repos:', error)
    return NextResponse.json(
      { error: 'Failed to fetch linked repositories' },
      { status: 500 }
    )
  }

  return NextResponse.json({ linkedRepos })
}

/**
 * Spaceにリポジトリを紐付け
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { spaceId, githubRepoId, syncPrs = true, syncCommits = false } = await request.json()

  if (!spaceId || !githubRepoId) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    )
  }

  // 認証確認
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Spaceメンバーシップ確認（admin/editor のみ）
   
  const { data: membership } = await (supabase as SupabaseClient)
    .from('space_memberships')
    .select('role')
    .eq('space_id', spaceId)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['admin', 'editor'].includes(membership.role as string)) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    )
  }

  // Space の org_id を取得
   
  const { data: space } = await (supabase as SupabaseClient)
    .from('spaces')
    .select('org_id')
    .eq('id', spaceId)
    .single()

  if (!space) {
    return NextResponse.json(
      { error: 'Space not found' },
      { status: 404 }
    )
  }

  // リポジトリの追加は GitHub を接続した本人だけができる
  const connectorAccess = await checkGithubConnectorAccess(supabase as SupabaseClient, space.org_id)
  if (!connectorAccess.ok) {
    return connectorAccess.response
  }

  // リポジトリが同じ組織に属しているか検証（クロス組織リンク防止）
   
  const { data: repo } = await (supabase as SupabaseClient)
    .from('github_repositories')
    .select('org_id')
    .eq('id', githubRepoId)
    .single()

  if (!repo) {
    return NextResponse.json(
      { error: 'Repository not found' },
      { status: 404 }
    )
  }

  if (repo.org_id !== space.org_id) {
    return NextResponse.json(
      { error: 'Repository belongs to a different organization' },
      { status: 403 }
    )
  }

  // リポジトリ紐付け
   
  const { data: linked, error } = await (supabase as SupabaseClient)
    .from('space_github_repos')
    .insert({
      org_id: space.org_id,
      space_id: spaceId,
      github_repo_id: githubRepoId,
      sync_prs: syncPrs,
      sync_commits: syncCommits,
      created_by: user.id,
    })
    .select(`
      id,
      sync_prs,
      sync_commits,
      github_repositories (
        id,
        full_name
      )
    `)
    .single()

  if (error) {
    if (error.code === '23505') { // unique violation
      return NextResponse.json(
        { error: 'Repository already linked to this space' },
        { status: 409 }
      )
    }
    console.error('Failed to link repository:', error)
    return NextResponse.json(
      { error: 'Failed to link repository' },
      { status: 500 }
    )
  }

  return NextResponse.json({ linked })
}

/**
 * Spaceからリポジトリの紐付けを解除
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const searchParams = request.nextUrl.searchParams
  const linkId = searchParams.get('linkId')

  if (!linkId) {
    return NextResponse.json(
      { error: 'Missing linkId parameter' },
      { status: 400 }
    )
  }

  // 認証確認
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // リンク情報取得

  const { data: link } = await (supabase as SupabaseClient)
    .from('space_github_repos')
    .select('space_id, org_id')
    .eq('id', linkId)
    .single()

  if (!link) {
    return NextResponse.json(
      { error: 'Link not found' },
      { status: 404 }
    )
  }

  // Spaceメンバーシップ確認（admin/editor のみ）

  const { data: membership } = await (supabase as SupabaseClient)
    .from('space_memberships')
    .select('role')
    .eq('space_id', link.space_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['admin', 'editor'].includes(membership.role as string)) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    )
  }

  // 連携の解除も GitHub を接続した本人だけができる（POSTと同じ判定）
  const connectorAccess = await checkGithubConnectorAccess(supabase as SupabaseClient, link.org_id)
  if (!connectorAccess.ok) {
    return connectorAccess.response
  }

  // 紐付け解除。`.select('id')` で実際に消えた行を確認する — ここまでの確認（メンバーシップ・
  // 接続者判定）を通っていても、RLS 等で実際には 0 行しか消えないことがありうるため、
  // その場合は「解除しました」を返さず 403 にする。
  const { data: deleted, error } = await (supabase as SupabaseClient)
    .from('space_github_repos')
    .delete()
    .eq('id', linkId)
    .select('id')

  if (error) {
    console.error('Failed to unlink repository:', error)
    return NextResponse.json(
      { error: 'Failed to unlink repository' },
      { status: 500 }
    )
  }

  if (!deleted || deleted.length === 0) {
    return NextResponse.json(
      { error: 'GitHub を接続した人だけが操作できます' },
      { status: 403 }
    )
  }

  return NextResponse.json({ success: true })
}
