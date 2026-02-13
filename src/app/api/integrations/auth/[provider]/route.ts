import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { getGoogleOAuthUrl, isGoogleCalendarFullyConfigured } from '@/lib/google-calendar/config'
import { getZoomOAuthUrl, isZoomOAuthConfigured } from '@/lib/zoom/config'
import { getTeamsOAuthUrl, isTeamsOAuthConfigured } from '@/lib/teams/config'

export const runtime = 'nodejs'

/**
 * HMAC signed state を生成（CSRF防止）
 */
function createSignedState(
  provider: string,
  orgId: string,
  userId: string,
): string {
  const stateSecret = process.env.OAUTH_STATE_SECRET || process.env.GOOGLE_STATE_SECRET
  if (!stateSecret) {
    throw new Error('OAUTH_STATE_SECRET or GOOGLE_STATE_SECRET must be configured')
  }
  const payload = JSON.stringify({ provider, orgId, userId, ts: Date.now() })
  const signature = createHmac('sha256', stateSecret)
    .update(payload)
    .digest('hex')
  const signedState = JSON.stringify({ payload, signature })
  return Buffer.from(signedState).toString('base64url')
}

/**
 * GET /api/integrations/auth/[provider]?orgId=...
 * OAuth認証URLにリダイレクト
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params

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
    const { data: membership } = await (supabase as any)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
    }

    if (provider === 'google_calendar') {
      if (!isGoogleCalendarFullyConfigured()) {
        return NextResponse.json({ error: 'Google Calendar OAuth is not configured' }, { status: 503 })
      }

      const state = createSignedState(provider, orgId, user.id)
      const oauthUrl = getGoogleOAuthUrl(state)
      return NextResponse.redirect(oauthUrl)
    }

    if (provider === 'zoom') {
      if (!isZoomOAuthConfigured()) {
        return NextResponse.json({ error: 'Zoom OAuth is not configured' }, { status: 503 })
      }

      const state = createSignedState(provider, orgId, user.id)
      return NextResponse.redirect(getZoomOAuthUrl(state))
    }

    if (provider === 'teams') {
      if (!isTeamsOAuthConfigured()) {
        return NextResponse.json({ error: 'Teams OAuth is not configured' }, { status: 503 })
      }

      const state = createSignedState(provider, orgId, user.id)
      return NextResponse.redirect(getTeamsOAuthUrl(state))
    }

    return NextResponse.json(
      { error: `Provider "${provider}" is not supported` },
      { status: 400 },
    )
  } catch (err) {
    console.error('Integration auth error:', err)
    return NextResponse.json({ error: 'Failed to start OAuth' }, { status: 500 })
  }
}
