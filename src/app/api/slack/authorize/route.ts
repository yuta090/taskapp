import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSlackOAuthUrl } from '@/lib/slack/oauth'
import { isSlackFullyConfigured } from '@/lib/slack/config'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * GET /api/slack/authorize?orgId=...&spaceId=...
 * Slack OAuth認証URLにリダイレクト
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isSlackFullyConfigured()) {
      return NextResponse.json({ error: 'Slack OAuth is not configured' }, { status: 503 })
    }

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('orgId')
    const spaceId = searchParams.get('spaceId')

    if (!orgId || !spaceId) {
      return NextResponse.json({ error: 'orgId and spaceId are required' }, { status: 400 })
    }

    // org owner権限チェック
    const { data: membership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only org owners can configure Slack' }, { status: 403 })
    }

    const oauthUrl = getSlackOAuthUrl(orgId, spaceId)
    return NextResponse.redirect(oauthUrl)
  } catch (err) {
    console.error('Slack authorize error:', err)
    return NextResponse.json({ error: 'Failed to start OAuth' }, { status: 500 })
  }
}
