import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifySlackRequest } from '@/lib/slack/verify'
import { getSlackClientForOrg } from '@/lib/slack/client'
import { buildTaskCreateModal } from '@/lib/slack/modals'

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
 * POST /api/slack/commands — /taskapp スラッシュコマンド受信
 */
export async function POST(request: NextRequest) {
  // 1. 署名検証
  const { verified, body } = await verifySlackRequest(request)
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 2. フォームデータをパース（Slack は application/x-www-form-urlencoded で送信）
  const params = new URLSearchParams(body)
  const triggerId = params.get('trigger_id') || ''
  const channelId = params.get('channel_id') || ''

  // 3. チャンネルから space_slack_channels を検索
  const { data: channelLink, error: channelError } = await (getSupabaseAdmin() as SupabaseClient)
    .from('space_slack_channels' as never)
    .select('org_id, space_id' as never)
    .eq('channel_id' as never, channelId as never)
    .single()

  if (channelError || !channelLink) {
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'このチャンネルはTaskAppに連携されていません',
    })
  }

  const { org_id: orgId, space_id: spaceId } = channelLink as unknown as {
    org_id: string
    space_id: string
  }

  try {
    // 4. スペース名を取得
    const { data: space } = await (getSupabaseAdmin() as SupabaseClient)
      .from('spaces' as never)
      .select('name' as never)
      .eq('id' as never, spaceId as never)
      .single()

    const spaceName = (space as unknown as { name: string } | null)?.name || 'プロジェクト'

    // 5. メンバー一覧を取得（担当者ドロップダウン用）
    const { data: memberships } = await (getSupabaseAdmin() as SupabaseClient)
      .from('space_memberships' as never)
      .select('user_id' as never)
      .eq('space_id' as never, spaceId as never)

    const memberRows = (memberships as unknown as Array<{ user_id: string }>) || []
    const memberIds = memberRows.map((m) => m.user_id)

    let members: Array<{ id: string; name: string }> = []
    if (memberIds.length > 0) {
      const { data: profiles } = await (getSupabaseAdmin() as SupabaseClient)
        .from('profiles' as never)
        .select('id, display_name' as never)
        .in('id' as never, memberIds as never)

      members = (
        (profiles as unknown as Array<{ id: string; display_name: string }>) || []
      ).map((p) => ({ id: p.id, name: p.display_name || 'User' }))
    }

    // 6. モーダルを構築して開く
    const modal = buildTaskCreateModal({
      spaceId,
      spaceName,
      channelId,
      members,
    })

    const slackClient = await getSlackClientForOrg(orgId)
    await slackClient.views.open({
      trigger_id: triggerId,
      view: modal as Parameters<typeof slackClient.views.open>[0]['view'],
    })

    // Slack は 200 + 空ボディを期待
    return new NextResponse(null, { status: 200 })
  } catch (err) {
    console.error('Failed to open task create modal:', err)
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'タスク作成モーダルの表示に失敗しました。管理者にお問い合わせください。',
    })
  }
}
