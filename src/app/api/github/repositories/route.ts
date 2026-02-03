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
