import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: space } = await (supabase as any)
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

  // リポジトリが同じ組織に属しているか検証（クロス組織リンク防止）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: repo } = await (supabase as any)
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linked, error } = await (supabase as any)
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link } = await (supabase as any)
    .from('space_github_repos')
    .select('space_id')
    .eq('id', linkId)
    .single()

  if (!link) {
    return NextResponse.json(
      { error: 'Link not found' },
      { status: 404 }
    )
  }

  // Spaceメンバーシップ確認（admin/editor のみ）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
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

  // 紐付け解除
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('space_github_repos')
    .delete()
    .eq('id', linkId)

  if (error) {
    console.error('Failed to unlink repository:', error)
    return NextResponse.json(
      { error: 'Failed to unlink repository' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
