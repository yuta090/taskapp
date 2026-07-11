import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { IntegrationConnection, IntegrationProvider } from './types'

let _supabaseAdmin: SupabaseClient | null = null
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 5 minutes buffer

type RefreshFn = (refreshToken: string) => Promise<{
  accessToken: string
  refreshToken?: string | null
  expiresAt: Date | null
}>

/**
 * refreshIfNeeded/getValidToken/getValidTokenDetailedが共有する内部コア。
 *
 * レビュー回帰対応(PR-4 Google Sheets adapter):
 * 1) refresh成功時、refresh_tokenは**truthyな値が返った時だけ**DBを上書きする。
 *    refreshAccessToken(google-calendar/client.ts)はGoogleのrefresh grantで
 *    refresh_tokenが返らない場合 `data.refresh_token ?? null` でnullを返すため、
 *    以前の `!== undefined` 判定だと毎回の成功refreshでDBのrefresh_tokenをnullに
 *    潰していた(接続後約55分の初回refreshで発生し、次の期限切れでexpired化していた)。
 * 2) refresh失敗を「失効」(400/401)と「一時障害」(5xx・ネットワークエラー・timeout等
 *    HTTP statusを持たない例外)に分類する。失効時のみstatus='expired'化してDBに残す。
 *    一時障害ではDBを一切更新しない(呼び出し側の再試行に委ねる)。
 */
type RefreshCoreResult =
  | { status: 'valid' | 'refreshed'; connection: IntegrationConnection }
  | { status: 'auth_failed' }
  | { status: 'transient_error' }

async function refreshIfNeededCore(connectionId: string, refreshFn: RefreshFn): Promise<RefreshCoreResult> {
  const { data: connection, error } = await getSupabaseAdmin()
    .from('integration_connections')
    .select('*')
    .eq('id', connectionId)
    .single()

  if (error || !connection) {
    console.error('Failed to fetch connection for refresh:', error)
    // 接続行の読み取り自体が失敗するケース(DB瞬断・稀な競合)。何が起きたか確定できないため
    // 安全側に倒してDBを触らず一時障害として返す(誤ってexpired化しない)。
    return { status: 'transient_error' }
  }

  // Check if token is still valid (with buffer)
  if (connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at).getTime()
    const now = Date.now()
    if (expiresAt - now > TOKEN_EXPIRY_BUFFER_MS) {
      return { status: 'valid', connection: connection as IntegrationConnection }
    }
  } else {
    // No expiry set, assume valid
    return { status: 'valid', connection: connection as IntegrationConnection }
  }

  // Token is expired or about to expire — refresh
  if (!connection.refresh_token) {
    // No refresh token, mark as expired
    await getSupabaseAdmin().from('integration_connections').update({ status: 'expired' }).eq('id', connectionId)
    return { status: 'auth_failed' }
  }

  try {
    const refreshed = await refreshFn(connection.refresh_token)

    const updateData: Record<string, unknown> = {
      access_token: refreshed.accessToken,
      token_expires_at: refreshed.expiresAt ? refreshed.expiresAt.toISOString() : null,
      last_refreshed_at: new Date().toISOString(),
      status: 'active',
    }

    // 回帰修正(修正1): refresh_tokenがtruthyな時だけ上書きする。null/undefinedは
    // 「ローテートされなかった」を意味し、既存のrefresh_tokenを保持する。
    if (refreshed.refreshToken) {
      updateData.refresh_token = refreshed.refreshToken
    }

    const { data: updated, error: updateError } = await getSupabaseAdmin()
      .from('integration_connections')
      .update(updateData)
      .eq('id', connectionId)
      .select('*')
      .single()

    if (updateError) {
      console.error('Failed to update refreshed token:', updateError)
      // 更新自体が失敗した(何も永続化されていない)。状態は変わっていないため一時障害扱い。
      return { status: 'transient_error' }
    }

    return { status: 'refreshed', connection: updated as IntegrationConnection }
  } catch (err) {
    const httpStatus = (err as { status?: number } | undefined)?.status
    if (httpStatus === 400 || httpStatus === 401) {
      // 失効(invalid_grant等) — 再認可が必要。DBへ反映しユーザーに再接続を促す。
      console.error('Token refresh failed (auth):', err)
      await getSupabaseAdmin().from('integration_connections').update({ status: 'expired' }).eq('id', connectionId)
      return { status: 'auth_failed' }
    }
    // 5xx・ネットワークエラー・timeout等statusを持たない失敗は一時障害。
    // DBを触らずactiveのまま残し、呼び出し側の再試行に委ねる。
    console.error('Token refresh failed (transient):', err)
    return { status: 'transient_error' }
  }
}

/**
 * Refresh the token if it is about to expire.
 * Returns the refreshed connection or null if refresh is not needed/possible.
 *
 * 既存契約を維持: 認証失敗・一時障害を問わずnullを返す(呼び出し元のgoogle-meet.ts /
 * freebusy/route.ts を壊さない)。DBの扱い(expired化するか否か)だけがrefreshIfNeededCoreの
 * 分類で変わる。
 */
export async function refreshIfNeeded(
  connectionId: string,
  refreshFn: RefreshFn,
): Promise<IntegrationConnection | null> {
  const result = await refreshIfNeededCore(connectionId, refreshFn)
  return result.status === 'valid' || result.status === 'refreshed' ? result.connection : null
}

/**
 * Get a valid access token for the given connection.
 * Refreshes if necessary using the provided refresh function.
 */
export async function getValidToken(connectionId: string, refreshFn: RefreshFn): Promise<string | null> {
  const connection = await refreshIfNeeded(connectionId, refreshFn)
  return connection?.access_token ?? null
}

export type ValidTokenDetailedResult =
  | { status: 'ok'; token: string }
  | { status: 'auth_failed' }
  | { status: 'transient_error' }

/**
 * getValidTokenの詳細版。失効(auth_failed)と一時障害(transient_error)を呼び出し側へ
 * 区別して返す。Google Sheets sink解決(sinks/store.ts)専用— 一時障害を
 * sink_not_deliverable(恒久失敗)ではなくtemporary_fail(再試行)として扱うために使う。
 * 既存のgetValidToken/refreshIfNeededの動作・シグネチャはそのまま(この関数は追加のみ)。
 */
export async function getValidTokenDetailed(
  connectionId: string,
  refreshFn: RefreshFn,
): Promise<ValidTokenDetailedResult> {
  const result = await refreshIfNeededCore(connectionId, refreshFn)
  if (result.status === 'valid' || result.status === 'refreshed') {
    return { status: 'ok', token: result.connection.access_token }
  }
  return { status: result.status }
}

/**
 * Revoke a token by marking it as revoked in the database.
 */
export async function revokeToken(connectionId: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('integration_connections')
    .update({ status: 'revoked' })
    .eq('id', connectionId)

  if (error) {
    console.error('Failed to revoke token:', error)
    return false
  }
  return true
}

/**
 * Find a connection for a given provider and owner.
 */
export async function findConnection(
  provider: IntegrationProvider,
  ownerType: 'user' | 'org',
  ownerId: string,
): Promise<IntegrationConnection | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('integration_connections')
    .select('*')
    .eq('provider', provider)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .eq('status', 'active')
    .single()

  if (error || !data) return null
  return data as IntegrationConnection
}
