import { NextRequest, NextResponse } from 'next/server'
import { WebClient } from '@slack/web-api'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SLACK_CONFIG } from '@/lib/slack/config'
import { invalidateSlackClientCache } from '@/lib/slack/client'

export const runtime = 'nodejs'

let _supabaseAdmin: ReturnType<typeof createSupabaseClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

/**
 * POST /api/slack/token — 手動でBot Tokenを登録
 * { orgId, botToken }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { orgId, botToken } = body

    if (!orgId || !botToken) {
      return NextResponse.json(
        { error: 'orgId and botToken are required' },
        { status: 400 },
      )
    }

    if (typeof botToken !== 'string' || !botToken.startsWith('xoxb-')) {
      return NextResponse.json(
        { error: 'Invalid bot token format. Must start with xoxb-' },
        { status: 400 },
      )
    }

    // org owner権限チェック
    const { data: membership } = await (supabase as any)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only org owners can configure Slack' },
        { status: 403 },
      )
    }

    // auth.test() でトークンを検証
    const testClient = new WebClient(botToken)
    let authResult
    try {
      authResult = await testClient.auth.test()
    } catch {
      return NextResponse.json(
        { error: 'Invalid bot token. auth.test() failed.' },
        { status: 400 },
      )
    }

    if (!authResult.ok) {
      return NextResponse.json(
        { error: 'Bot token verification failed' },
        { status: 400 },
      )
    }

    // トークンを暗号化
    const { data: encryptedToken, error: encryptError } = await (getSupabaseAdmin() as any)
      .rpc('encrypt_slack_token', {
        token: botToken,
        secret: SLACK_CONFIG.clientSecret,
      })

    if (encryptError || !encryptedToken) {
      console.error('Token encryption failed:', encryptError)
      return NextResponse.json(
        { error: 'Failed to encrypt token' },
        { status: 500 },
      )
    }

    // DB保存（upsert）
    const { error: upsertError } = await (getSupabaseAdmin() as any)
      .from('slack_workspaces')
      .upsert(
        {
          org_id: orgId,
          team_id: authResult.team_id || 'manual',
          team_name: (authResult.team as string) || 'Manual Setup',
          bot_token_encrypted: encryptedToken,
          bot_user_id: authResult.user_id || null,
          installed_by: user.id,
          created_by: user.id,
          token_obtained_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,team_id' },
      )

    if (upsertError) {
      console.error('Workspace save failed:', upsertError)
      return NextResponse.json(
        { error: 'Failed to save workspace' },
        { status: 500 },
      )
    }

    // キャッシュ無効化
    invalidateSlackClientCache(orgId)

    return NextResponse.json({
      success: true,
      workspace: {
        teamId: authResult.team_id,
        teamName: authResult.team,
        botUserId: authResult.user_id,
      },
    })
  } catch (err) {
    console.error('Slack token save error:', err)
    return NextResponse.json(
      { error: 'Failed to save token' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/slack/token?orgId=...
 * Slack連携を解除
 */
export async function DELETE(request: NextRequest) {
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

    // org owner権限チェック
    const { data: membership } = await (supabase as any)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only org owners can disconnect Slack' },
        { status: 403 },
      )
    }

    // workspace削除（cascade で space_slack_channels も削除される）
    const { error } = await (getSupabaseAdmin() as any)
      .from('slack_workspaces')
      .delete()
      .eq('org_id', orgId)

    if (error) {
      console.error('Failed to delete workspace:', error)
      return NextResponse.json(
        { error: 'Failed to disconnect Slack' },
        { status: 500 },
      )
    }

    // キャッシュ無効化
    invalidateSlackClientCache(orgId)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Slack disconnect error:', err)
    return NextResponse.json(
      { error: 'Failed to disconnect' },
      { status: 500 },
    )
  }
}
