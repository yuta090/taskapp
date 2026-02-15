import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listSlackChannels } from '@/lib/slack'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * GET /api/slack/channels?orgId=... — Botがアクセス可能なチャンネル一覧
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

    // org membership チェック
    const { data: membership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const channels = await listSlackChannels(orgId)
    return NextResponse.json({ channels })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // workspaceが未設定の場合は空配列を返す
    if (message.includes('not configured')) {
      return NextResponse.json({ channels: [] })
    }
    console.error('Failed to list Slack channels:', err)
    return NextResponse.json(
      { error: 'Failed to list channels' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/slack/channels — SpaceにSlackチャンネルを紐付け
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { spaceId, channelId, channelName } = body

    if (!spaceId || !channelId || !channelName) {
      return NextResponse.json(
        { error: 'spaceId, channelId, and channelName are required' },
        { status: 400 },
      )
    }

    // admin/editor権限チェック
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('role')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['admin', 'editor'].includes(membership.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Space の org_id を取得
    const { data: space } = await (supabase as SupabaseClient)
      .from('spaces')
      .select('org_id')
      .eq('id', spaceId)
      .single()

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // Slack workspace を取得（OAuth/手動入力で作成済みであること）
    const { data: workspace } = await (supabase as SupabaseClient)
      .from('slack_workspaces')
      .select('id')
      .eq('org_id', space.org_id)
      .not('bot_token_encrypted', 'is', null)
      .single()

    if (!workspace) {
      return NextResponse.json(
        { error: 'Slack workspace not connected. Please connect Slack first.' },
        { status: 400 },
      )
    }

    // Upsert チャンネル紐付け（space_id UNIQUE）
    const { data: channel, error: chError } = await (supabase as SupabaseClient)
      .from('space_slack_channels')
      .upsert(
        {
          org_id: space.org_id,
          space_id: spaceId,
          slack_workspace_id: workspace.id,
          channel_id: channelId,
          channel_name: channelName,
          created_by: user.id,
        },
        { onConflict: 'space_id' },
      )
      .select('*')
      .single()

    if (chError) {
      console.error('Failed to link channel:', chError)
      return NextResponse.json({ error: 'Failed to link channel' }, { status: 500 })
    }

    return NextResponse.json({ success: true, channel })
  } catch (err) {
    console.error('Failed to link Slack channel:', err)
    return NextResponse.json(
      { error: 'Failed to link channel' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/slack/channels — Spaceのチャンネル紐付けを解除
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 })
    }

    // admin/editor権限チェック
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('role')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['admin', 'editor'].includes(membership.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await (supabase as SupabaseClient)
      .from('space_slack_channels')
      .delete()
      .eq('space_id', spaceId)

    if (error) {
      console.error('Failed to unlink channel:', error)
      return NextResponse.json({ error: 'Failed to unlink channel' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to unlink Slack channel:', err)
    return NextResponse.json(
      { error: 'Failed to unlink channel' },
      { status: 500 },
    )
  }
}
