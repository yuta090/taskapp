import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGitHubInstallUrl, isGitHubFullyConfigured } from '@/lib/github/config'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const DEFAULT_REDIRECT = '/settings/org-integrations'

/**
 * インストール後の戻り先はサイト内パスだけ許可する（open redirect 防止）。
 * "/foo" は可、"//evil" や "https://..." は既定に置き換える。
 */
function sanitizeRedirect(value: string | null): string {
  if (!value) return DEFAULT_REDIRECT
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_REDIRECT
  return value
}

/**
 * GET /api/github/authorize?orgId=...&redirect=/settings/org-integrations
 *
 * GitHub App のインストール URL へリダイレクトする。
 * URL の組み立て（App slug）と state の HMAC 署名はサーバー側の環境変数が必要なので、
 * クライアントコンポーネントから getGitHubInstallUrl() を直接呼んではいけない
 * （ブラウザでは slug が既定値に落ちて 404 になり、署名も空鍵になる）。
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('orgId')
    if (!orgId) {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }

    // org owner のみ（Slack authorize と同じ境界）
    const { data: membership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only org owners can configure GitHub' }, { status: 403 })
    }

    if (!isGitHubFullyConfigured()) {
      return NextResponse.json({ error: 'GitHub App is not configured' }, { status: 503 })
    }

    const redirectUri = sanitizeRedirect(searchParams.get('redirect'))
    return NextResponse.redirect(getGitHubInstallUrl(orgId, redirectUri))
  } catch (err) {
    console.error('GitHub authorize error:', err)
    return NextResponse.json({ error: 'Failed to start GitHub install' }, { status: 500 })
  }
}
