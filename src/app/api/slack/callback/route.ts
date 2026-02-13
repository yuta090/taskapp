import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { verifySignedState, exchangeCodeForToken } from '@/lib/slack/oauth'
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
 * GET /api/slack/callback?code=...&state=...
 * Slack OAuthコールバック → トークン取得・暗号化保存 → 設定画面にリダイレクト
 */
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    // 認証チェック
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.redirect(`${appUrl}/login?error=unauthorized`)
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const slackError = searchParams.get('error')

    // ユーザーがキャンセルした場合
    if (slackError) {
      const stateData = state ? verifySignedState(state) : null
      const redirect = stateData
        ? `${appUrl}/${stateData.orgId}/project/${stateData.spaceId}/settings?slack=cancelled`
        : `${appUrl}?slack=cancelled`
      return NextResponse.redirect(redirect)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${appUrl}?error=missing_params`)
    }

    // State検証（CSRF防止 + 有効期限）
    const stateData = verifySignedState(state)
    if (!stateData) {
      return NextResponse.redirect(`${appUrl}?error=invalid_state`)
    }

    const { orgId, spaceId } = stateData

    // コード→トークン交換
    const tokenResponse = await exchangeCodeForToken(code)

    if (!tokenResponse.ok || !tokenResponse.access_token) {
      console.error('Slack token exchange failed:', tokenResponse.error)
      return NextResponse.redirect(
        `${appUrl}/${orgId}/project/${spaceId}/settings?slack=error&message=${encodeURIComponent(tokenResponse.error || 'token_exchange_failed')}`,
      )
    }

    // トークンを暗号化
    const { data: encryptedToken, error: encryptError } = await (getSupabaseAdmin() as any)
      .rpc('encrypt_slack_token', {
        token: tokenResponse.access_token,
        secret: SLACK_CONFIG.clientSecret,
      })

    if (encryptError || !encryptedToken) {
      console.error('Token encryption failed:', encryptError)
      return NextResponse.redirect(
        `${appUrl}/${orgId}/project/${spaceId}/settings?slack=error&message=encryption_failed`,
      )
    }

    // DB保存（upsert: org_id + team_id でユニーク）
    const { error: upsertError } = await (getSupabaseAdmin() as any)
      .from('slack_workspaces')
      .upsert(
        {
          org_id: orgId,
          team_id: tokenResponse.team?.id || 'unknown',
          team_name: tokenResponse.team?.name || 'Unknown Workspace',
          bot_token_encrypted: encryptedToken,
          bot_user_id: tokenResponse.bot_user_id || null,
          app_id: tokenResponse.app_id || null,
          scope: tokenResponse.scope || null,
          installed_by: user.id,
          created_by: user.id,
          token_obtained_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,team_id' },
      )

    if (upsertError) {
      console.error('Workspace save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}/${orgId}/project/${spaceId}/settings?slack=error&message=save_failed`,
      )
    }

    // キャッシュを無効化
    invalidateSlackClientCache(orgId)

    // 成功 → 設定画面にリダイレクト
    return NextResponse.redirect(
      `${appUrl}/${orgId}/project/${spaceId}/settings?slack=connected`,
    )
  } catch (err) {
    console.error('Slack callback error:', err)
    return NextResponse.redirect(`${appUrl}?error=slack_callback_failed`)
  }
}
