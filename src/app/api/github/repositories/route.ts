import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * 組織の連携リポジトリ一覧を取得
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const searchParams = request.nextUrl.searchParams
  const orgId = searchParams.get('orgId')

  if (!orgId) {
    return NextResponse.json(
      { error: 'Missing orgId parameter' },
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

  // 組織メンバーシップ確認
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json(
      { error: 'Not a member of this organization' },
      { status: 403 }
    )
  }

  // リポジトリ一覧・リポジトリ名は GitHub を接続した本人だけに見せる。
  // github_installations は RLS で created_by = 自分 の行しか返らないため、
  // ログイン中の本人のセッションで読んで 0 行なら本人ではないと判定できる。
  const { data: installation, error: installationError } = await supabase
    .from('github_installations')
    .select('id')
    .eq('org_id', orgId)
    .maybeSingle()

  // 問い合わせ自体が失敗したときは「本人ではない(403)」と区別する。ここを区別しないと、
  // 一時的な障害のたびに本人にまで「接続した人だけが操作できます」という誤った案内が出る。
  if (installationError) {
    console.error('Failed to check GitHub installation ownership:', installationError)
    return NextResponse.json(
      { error: '接続状態の確認に失敗しました' },
      { status: 500 }
    )
  }

  if (!installation) {
    return NextResponse.json(
      { error: 'GitHub を接続した人だけが操作できます' },
      { status: 403 }
    )
  }

  // リポジトリ一覧取得
  const { data: repositories, error } = await supabase
    .from('github_repositories')
    .select(`
      id,
      repo_id,
      owner_login,
      repo_name,
      full_name,
      default_branch,
      is_private,
      created_at
    `)
    .eq('org_id', orgId)
    .order('full_name')

  if (error) {
    console.error('Failed to fetch repositories:', error)
    return NextResponse.json(
      { error: 'Failed to fetch repositories' },
      { status: 500 }
    )
  }

  return NextResponse.json({ repositories })
}
