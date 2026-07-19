import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google-calendar/client'
import { exchangeZoomCode } from '@/lib/zoom/client'
import { exchangeTeamsCode } from '@/lib/teams/client'
import { exchangeNotionCode } from '@/lib/notion/client'
import { exchangeGoogleSheetsCode } from '@/lib/google-sheets/client'
import { exchangeGoogleTasksCode } from '@/lib/google-tasks/client'
import { buildTokenColumns } from '@/lib/integrations/token-manager'

export const runtime = 'nodejs'

let _supabaseAdmin: SupabaseClient<Database> | null = null
function getSupabaseAdmin(): SupabaseClient<Database> {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient<Database>(
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

    if (provider === 'notion') {
      return await handleNotionCallback(code, orgId, appUrl)
    }

    if (provider === 'google_sheets') {
      return await handleGoogleSheetsCallback(code, orgId, appUrl)
    }

    if (provider === 'google_tasks') {
      return await handleGoogleTasksCallback(code, orgId, user.id, appUrl)
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
    const { error: upsertError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('integration_connections')
      .upsert(
        {
          provider: 'google_calendar',
          owner_type: 'user',
          owner_id: userId,
          org_id: orgId,
          ...(await buildTokenColumns({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          })),
          token_expires_at: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {},
        },
        { onConflict: 'provider,owner_type,owner_id' },
      )

    if (upsertError) {
      console.error('Integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}?integration=google_calendar&status=error&message=save_failed`,
      )
    }

    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=google_calendar&status=connected`,
    )
  } catch (err) {
    console.error('Google Calendar callback error:', err)
    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=google_calendar&status=error&message=token_exchange_failed`,
    )
  }
}

/**
 * Google Tasks は google_calendar と同じ user 単位接続。個人の Google Tasks は共有不可なので
 * 必然的に user 所有。tasklist の確保(ensureTaskList)と既存タスクのバックフィルは接続確立後に
 * ワーカー側で行うため、ここは接続の保存に専念する(metadata は空)。
 */
async function handleGoogleTasksCallback(
  code: string,
  orgId: string,
  userId: string,
  appUrl: string,
): Promise<NextResponse> {
  try {
    const tokens = await exchangeGoogleTasksCode(code)

    const { data: saved, error: upsertError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('integration_connections')
      .upsert(
        {
          provider: 'google_tasks',
          owner_type: 'user',
          owner_id: userId,
          org_id: orgId,
          ...(await buildTokenColumns({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          })),
          token_expires_at: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {},
        },
        { onConflict: 'provider,owner_type,owner_id' },
      )
      .select('id')
      .single()

    if (upsertError) {
      console.error('Google Tasks integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}/settings/integrations?integration=google_tasks&status=error&message=save_failed`,
      )
    }

    // 接続直後に既存のミラー対象タスクを一括 enqueue(best-effort。失敗しても接続は成立させる)。
    // トリガーは将来の変更しか拾わないため、既存分はここで backfill する。
    if (saved?.id) {
      const { error: backfillError } = await (getSupabaseAdmin() as SupabaseClient).rpc(
        'rpc_backfill_task_mirror',
        { p_connection_id: saved.id },
      )
      if (backfillError) console.error('Google Tasks backfill enqueue failed (non-fatal):', backfillError)
    }

    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=google_tasks&status=connected`,
    )
  } catch (err) {
    console.error('Google Tasks callback error:', err)
    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=google_tasks&status=error&message=token_exchange_failed`,
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

    const { error: upsertError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('integration_connections')
      .upsert(
        {
          provider: 'zoom',
          owner_type: 'user',
          owner_id: userId,
          org_id: orgId,
          ...(await buildTokenColumns({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          })),
          token_expires_at: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {},
        },
        { onConflict: 'provider,owner_type,owner_id' },
      )

    if (upsertError) {
      console.error('Zoom integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}/settings/integrations?integration=zoom&status=error&message=save_failed`,
      )
    }

    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=zoom&status=connected`,
    )
  } catch (err) {
    console.error('Zoom callback error:', err)
    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=zoom&status=error&message=token_exchange_failed`,
    )
  }
}

/**
 * Notionはowner_type='org'でupsertする（org単位1ワークスペース。§1-1のunique制約）。
 * userIdはstate検証（本人確認）のみに使い、接続の帰属はorg単位のため保存には使わない。
 * リダイレクト先は既存の/settings/integrationsではなく秘書コンソールの連携タブ。
 */
async function handleNotionCallback(
  code: string,
  orgId: string,
  appUrl: string,
): Promise<NextResponse> {
  const integrationsTabUrl = `${appUrl}/${orgId}/secretary/integrations`
  try {
    const tokens = await exchangeNotionCode(code)

    // Notionトークンは無期限（refresh_tokenなし、token_expires_atはnull）。
    const { error: upsertError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('integration_connections')
      .upsert(
        {
          provider: 'notion',
          owner_type: 'org',
          owner_id: orgId,
          org_id: orgId,
          // Notionトークンは無期限(refresh_tokenなし)。buildTokenColumnsはrefreshTokenが
          // falsyならrefresh_token系のキー自体を含めないので、列はnullのまま作られる。
          ...(await buildTokenColumns({ accessToken: tokens.accessToken })),
          token_expires_at: null,
          scopes: null,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {
            workspace_id: tokens.workspaceId,
            workspace_name: tokens.workspaceName,
            workspace_icon: tokens.workspaceIcon,
            bot_id: tokens.botId,
          },
        },
        { onConflict: 'provider,owner_type,owner_id' },
      )

    if (upsertError) {
      console.error('Notion integration connection save failed:', upsertError)
      return NextResponse.redirect(`${integrationsTabUrl}?integration=notion&status=error&message=save_failed`)
    }

    return NextResponse.redirect(`${integrationsTabUrl}?integration=notion&status=connected`)
  } catch (err) {
    console.error('Notion callback error:', err)
    return NextResponse.redirect(
      `${integrationsTabUrl}?integration=notion&status=error&message=token_exchange_failed`,
    )
  }
}

/**
 * Google Sheetsはnotionと同じくowner_type='org'でupsertする（org単位1接続。§1-1のunique制約）。
 * userIdはstate検証（本人確認）のみに使い、接続の帰属はorg単位のため保存には使わない。
 * リダイレクト先はnotionと同じ秘書コンソールの連携タブ。
 * refreshTokenがnullの場合はupsertペイロードにrefresh_tokenキー自体を含めない
 * （レビュー回帰対応: 含めるとon conflict時にnullで上書きされ、再認可(reconnect)で
 * 既存の有効なrefresh_tokenを失ってしまう。省略すればon conflict時に既存値が保持される。
 * 新規接続でrefreshTokenがnullなら、その行は初めからrefresh_tokenを持たない状態で作られ、
 * token-manager.refreshIfNeededが有効期限切れ後にstatus='expired'化して顕在化させる）。
 */
async function handleGoogleSheetsCallback(
  code: string,
  orgId: string,
  appUrl: string,
): Promise<NextResponse> {
  const integrationsTabUrl = `${appUrl}/${orgId}/secretary/integrations`
  try {
    const tokens = await exchangeGoogleSheetsCode(code)

    const upsertPayload: Record<string, unknown> = {
      provider: 'google_sheets',
      owner_type: 'org',
      owner_id: orgId,
      org_id: orgId,
      // refreshTokenがnullならrefresh_token系のキー自体を含めない(上のコメント参照)。
      // buildTokenColumnsがその判定を持つ。
      ...(await buildTokenColumns({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      })),
      token_expires_at: tokens.expiresAt.toISOString(),
      scopes: tokens.scopes,
      status: 'active',
      last_refreshed_at: new Date().toISOString(),
      metadata: {},
    }

    const { error: upsertError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('integration_connections')
      .upsert(upsertPayload, { onConflict: 'provider,owner_type,owner_id' })

    if (upsertError) {
      console.error('Google Sheets integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${integrationsTabUrl}?integration=google_sheets&status=error&message=save_failed`,
      )
    }

    return NextResponse.redirect(`${integrationsTabUrl}?integration=google_sheets&status=connected`)
  } catch (err) {
    console.error('Google Sheets callback error:', err)
    return NextResponse.redirect(
      `${integrationsTabUrl}?integration=google_sheets&status=error&message=token_exchange_failed`,
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

    const { error: upsertError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('integration_connections')
      .upsert(
        {
          provider: 'teams',
          owner_type: 'user',
          owner_id: userId,
          org_id: orgId,
          ...(await buildTokenColumns({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          })),
          token_expires_at: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          status: 'active',
          last_refreshed_at: new Date().toISOString(),
          metadata: {},
        },
        { onConflict: 'provider,owner_type,owner_id' },
      )

    if (upsertError) {
      console.error('Teams integration connection save failed:', upsertError)
      return NextResponse.redirect(
        `${appUrl}/settings/integrations?integration=teams&status=error&message=save_failed`,
      )
    }

    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=teams&status=connected`,
    )
  } catch (err) {
    console.error('Teams callback error:', err)
    return NextResponse.redirect(
      `${appUrl}/settings/integrations?integration=teams&status=error&message=token_exchange_failed`,
    )
  }
}
