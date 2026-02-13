import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google-calendar/client'
import { exchangeZoomCode } from '@/lib/zoom/client'
import { exchangeTeamsCode } from '@/lib/teams/client'

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
 * Verify HMAC signed state (15 minute expiry)
 */
function verifySignedState(state: string): {
  provider: string
  orgId: string
  userId: string
} | null {
  try {
    const stateSecret = process.env.OAUTH_STATE_SECRET || process.env.GOOGLE_STATE_SECRET
    if (!stateSecret) {
      return null // Secret not configured, reject all states
    }
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
    const { payload, signature } = decoded

    const expectedSignature = createHmac('sha256', stateSecret)
      .update(payload)
      .digest('hex')

    const signatureBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null
    }

    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null
    }

    const parsedPayload = JSON.parse(payload)

    // 有効期限チェック（15分）
    const maxAge = 15 * 60 * 1000
    if (Date.now() - parsedPayload.ts > maxAge) {
      console.warn('Integration OAuth state expired')
      return null
    }

    return {
      provider: parsedPayload.provider,
      orgId: parsedPayload.orgId,
      userId: parsedPayload.userId,
    }
  } catch (e) {
    console.error('Failed to verify integration OAuth state:', e)
    return null
  }
}

/**
 * GET /api/integrations/callback/[provider]?code=...&state=...
 * OAuthコールバック → トークン取得・DB保存 → 設定画面にリダイレクト
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const { provider } = await params

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
    const oauthError = searchParams.get('error')

    // ユーザーがキャンセルした場合
    if (oauthError) {
      return NextResponse.redirect(`${appUrl}?integration=${provider}&status=cancelled`)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${appUrl}?error=missing_params`)
    }

    // State検証（CSRF防止 + 有効期限）
    const stateData = verifySignedState(state)
    if (!stateData) {
      return NextResponse.redirect(`${appUrl}?error=invalid_state`)
    }

    if (stateData.provider !== provider) {
      return NextResponse.redirect(`${appUrl}?error=provider_mismatch`)
    }

    // セッションユーザーとstateのユーザーが一致するか確認
    if (stateData.userId !== user.id) {
      return NextResponse.redirect(`${appUrl}?error=user_mismatch`)
    }

    const { orgId } = stateData

    if (provider === 'google_calendar') {
      return await handleGoogleCalendarCallback(code, orgId, user.id, appUrl)
    }

    if (provider === 'zoom') {
      return await handleZoomCallback(code, orgId, user.id, appUrl)
    }

    if (provider === 'teams') {
      return await handleTeamsCallback(code, orgId, user.id, appUrl)
    }

    return NextResponse.redirect(`${appUrl}?error=unsupported_provider`)
  } catch (err) {
    console.error('Integration callback error:', err)
    return NextResponse.redirect(`${appUrl}?error=callback_failed`)
  }
}

async function handleGoogleCalendarCallback(
  code: string,
  orgId: string,
  userId: string,
  appUrl: string,
): Promise<NextResponse> {
  try {
    const tokens = await exchangeCodeForTokens(code)

    // DB保存（upsert: provider + owner_type + owner_id でユニーク）
    const { error: upsertError } = await (getSupabaseAdmin() as any)
      .from('integration_connections')
      .upsert(
        {
          provider: 'google_calendar',
          owner_type: 'user',
          owner_id: userId,
          org_id: orgId,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {},
        } as any,
        { onConflict: 'provider,owner_type,owner_id' },
      )

    if (upsertError) {
      console.error('Integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}?integration=google_calendar&status=error&message=save_failed`,
      )
    }

    // Find any space for this org to redirect to settings
    const { data: space } = await (getSupabaseAdmin() as any)
      .from('spaces')
      .select('id')
      .eq('org_id', orgId)
      .limit(1)
      .single()

    const redirectPath = space
      ? `${appUrl}/${orgId}/project/${space.id}/settings?integration=google_calendar&status=connected`
      : `${appUrl}?integration=google_calendar&status=connected`

    return NextResponse.redirect(redirectPath)
  } catch (err) {
    console.error('Google Calendar callback error:', err)
    return NextResponse.redirect(
      `${appUrl}?integration=google_calendar&status=error&message=token_exchange_failed`,
    )
  }
}

async function handleZoomCallback(
  code: string,
  orgId: string,
  userId: string,
  appUrl: string,
): Promise<NextResponse> {
  try {
    const tokens = await exchangeZoomCode(code)

    const { error: upsertError } = await (getSupabaseAdmin() as any)
      .from('integration_connections')
      .upsert(
        {
          provider: 'zoom',
          owner_type: 'user',
          owner_id: userId,
          org_id: orgId,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {},
        } as any,
        { onConflict: 'provider,owner_type,owner_id' },
      )

    if (upsertError) {
      console.error('Zoom integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}?integration=zoom&status=error&message=save_failed`,
      )
    }

    const { data: space } = await (getSupabaseAdmin() as any)
      .from('spaces')
      .select('id')
      .eq('org_id', orgId)
      .limit(1)
      .single()

    const redirectPath = space
      ? `${appUrl}/${orgId}/project/${space.id}/settings?integration=zoom&status=connected`
      : `${appUrl}?integration=zoom&status=connected`

    return NextResponse.redirect(redirectPath)
  } catch (err) {
    console.error('Zoom callback error:', err)
    return NextResponse.redirect(
      `${appUrl}?integration=zoom&status=error&message=token_exchange_failed`,
    )
  }
}

async function handleTeamsCallback(
  code: string,
  orgId: string,
  userId: string,
  appUrl: string,
): Promise<NextResponse> {
  try {
    const tokens = await exchangeTeamsCode(code)

    const { error: upsertError } = await (getSupabaseAdmin() as any)
      .from('integration_connections')
      .upsert(
        {
          provider: 'teams',
          owner_type: 'user',
          owner_id: userId,
          org_id: orgId,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {},
        } as any,
        { onConflict: 'provider,owner_type,owner_id' },
      )

    if (upsertError) {
      console.error('Teams integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}?integration=teams&status=error&message=save_failed`,
      )
    }

    const { data: space } = await (getSupabaseAdmin() as any)
      .from('spaces')
      .select('id')
      .eq('org_id', orgId)
      .limit(1)
      .single()

    const redirectPath = space
      ? `${appUrl}/${orgId}/project/${space.id}/settings?integration=teams&status=connected`
      : `${appUrl}?integration=teams&status=connected`

    return NextResponse.redirect(redirectPath)
  } catch (err) {
    console.error('Teams callback error:', err)
    return NextResponse.redirect(
      `${appUrl}?integration=teams&status=error&message=token_exchange_failed`,
    )
  }
}
