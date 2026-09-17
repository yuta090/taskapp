import { createAdminClient } from '@/lib/supabase/admin'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  expiresAt,
  hashSecret,
  newOAuthToken,
  newSecret,
} from './secrets'

/**
 * OAuth の3つの表への出し入れ。DB に触るのはこのファイルだけにする。
 *
 * ⚠ ここは公開インターネットから叩かれる入口の裏側。次を必ず守る:
 *   - 生の文字列は保存しない（控えだけ）
 *   - 引換券は一度きり。使い回しを見つけたら、そこから出た合鍵を全部止める
 *   - 付け替え用の合鍵も使い回しを見つけたら系列ごと止める
 */

export interface OAuthClient {
  clientId: string
  clientName: string
  redirectUris: string[]
}

export interface PendingConsent {
  clientId: string
  userId: string
  orgId: string
  redirectUri: string
  codeChallenge: string
  allowedActions: string[]
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** 1時間のうちに同じ相手から受け付ける登録の数 */
export const REGISTRATION_LIMIT_PER_HOUR = 10

/** 同じ相手からの登録が多すぎないか。Vercel は共有メモリが無いので DB で数える */
export async function tooManyRecentRegistrations(ipHash: string | null): Promise<boolean> {
  if (!ipHash) return false
  const admin = createAdminClient()
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error } = await admin
    .from('oauth_clients')
    .select('id', { count: 'exact', head: true })
    .eq('registrant_ip_hash', ipHash)
    .gte('created_at', since)

  if (error) throw new Error(error.message)
  return (count ?? 0) >= REGISTRATION_LIMIT_PER_HOUR
}

export async function registerClient(params: {
  clientName: string
  redirectUris: string[]
  ipHash: string | null
}): Promise<OAuthClient> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('oauth_clients')
    .insert({
      client_name: params.clientName,
      redirect_uris: params.redirectUris,
      registrant_ip_hash: params.ipHash,
    })
    .select('client_id, client_name, redirect_uris')
    .single()

  if (error || !data) throw new Error(error?.message || '登録できませんでした')
  return { clientId: data.client_id, clientName: data.client_name, redirectUris: data.redirect_uris }
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle()

  if (!data) return null
  return { clientId: data.client_id, clientName: data.client_name, redirectUris: data.redirect_uris }
}

/** 同意が成立した。引換券を1枚出す（生の値は戻り値だけ・DB には控え） */
export async function createAuthorizationCode(consent: PendingConsent): Promise<string> {
  const admin = createAdminClient()
  const code = newSecret()

  const { error } = await admin.from('oauth_authorization_codes').insert({
    code_hash: hashSecret(code),
    client_id: consent.clientId,
    user_id: consent.userId,
    org_id: consent.orgId,
    redirect_uri: consent.redirectUri,
    code_challenge: consent.codeChallenge,
    allowed_actions: consent.allowedActions,
    expires_at: expiresAt(AUTHORIZATION_CODE_TTL_SECONDS),
  })

  if (error) throw new Error(error.message)
  return code
}

export interface ConsumedCode {
  id: string
  clientId: string
  userId: string
  orgId: string
  redirectUri: string
  codeChallenge: string
  allowedActions: string[]
}

/**
 * 引換券を引き換える。一度きり。
 *
 * すでに使われていた引換券が持ち込まれたら、盗まれたと見なして
 * そこから出た合鍵を全部止める（返り値は null）。
 */
export async function consumeAuthorizationCode(code: string): Promise<ConsumedCode | null> {
  const admin = createAdminClient()
  const codeHash = hashSecret(code)

  const { data: row } = await admin
    .from('oauth_authorization_codes')
    .select('id, client_id, user_id, org_id, redirect_uri, code_challenge, allowed_actions, used_at, expires_at')
    .eq('code_hash', codeHash)
    .maybeSingle()

  if (!row) return null

  // 使い回し: この引換券から出た合鍵を全部止める
  if (row.used_at) {
    const { data: tokens } = await admin
      .from('oauth_tokens')
      .select('family_id')
      .eq('authorization_code_id', row.id)
      .limit(1)
    const familyId = tokens?.[0]?.family_id
    if (familyId) await admin.rpc('revoke_oauth_token_family', { p_family_id: familyId })
    return null
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) return null

  // 使用済みにする。同時に2回来ても1回しか通らないよう used_at is null を条件にする
  const { data: claimed } = await admin
    .from('oauth_authorization_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id')

  if (!claimed || claimed.length === 0) return null

  return {
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    orgId: row.org_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    allowedActions: row.allowed_actions,
  }
}

/** 合鍵を1組（使う用・付け替え用）出す */
export async function issueTokens(params: {
  clientId: string
  userId: string
  orgId: string
  apiKeyId: string
  authorizationCodeId: string | null
  familyId?: string
}): Promise<IssuedTokens> {
  const admin = createAdminClient()
  const accessToken = newOAuthToken()
  const refreshToken = newOAuthToken()
  const base = {
    client_id: params.clientId,
    user_id: params.userId,
    org_id: params.orgId,
    api_key_id: params.apiKeyId,
    authorization_code_id: params.authorizationCodeId,
    ...(params.familyId ? { family_id: params.familyId } : {}),
  }

  const { error } = await admin.from('oauth_tokens').insert([
    { ...base, token_hash: hashSecret(accessToken), kind: 'access', expires_at: expiresAt(ACCESS_TOKEN_TTL_SECONDS) },
    { ...base, token_hash: hashSecret(refreshToken), kind: 'refresh', expires_at: expiresAt(REFRESH_TOKEN_TTL_SECONDS) },
  ])

  if (error) throw new Error(error.message)
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS }
}

/**
 * 付け替え用の合鍵を使って、新しい1組に差し替える。
 * すでに使われた付け替え用が持ち込まれたら、系列ごと止める（返り値は null）。
 */
export async function rotateRefreshToken(refreshToken: string, clientId: string): Promise<IssuedTokens | null> {
  const admin = createAdminClient()
  const tokenHash = hashSecret(refreshToken)

  const { data: row } = await admin
    .from('oauth_tokens')
    .select('id, client_id, user_id, org_id, api_key_id, family_id, authorization_code_id, used_at, revoked_at, expires_at')
    .eq('token_hash', tokenHash)
    .eq('kind', 'refresh')
    .maybeSingle()

  if (!row) return null
  if (row.client_id !== clientId) return null

  // 使い回し／失効済み: 系列ごと止める
  if (row.used_at || row.revoked_at) {
    await admin.rpc('revoke_oauth_token_family', { p_family_id: row.family_id })
    return null
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) return null

  const { data: claimed } = await admin
    .from('oauth_tokens')
    .update({ used_at: new Date().toISOString(), revoked_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id')

  if (!claimed || claimed.length === 0) return null

  return issueTokens({
    clientId: row.client_id,
    userId: row.user_id,
    orgId: row.org_id,
    apiKeyId: row.api_key_id,
    authorizationCodeId: row.authorization_code_id,
    familyId: row.family_id,
  })
}


/**
 * 同意の結果を api_keys の1行として残す。
 *
 * 認可の判定は既存の mcp_authorize がこの行を見て行う（入口を2本にしない）。
 * key_hash には**誰にも渡さない**乱数の控えを入れる。こうしておくと、この行は
 * OAuth の合鍵経由（/api/mcp）でしか使えず、生のAPIキーを見る /api/tools では通らない。
 */
export async function createOAuthApiKey(params: {
  clientId: string
  clientName: string
  userId: string
  orgId: string
  allowedActions: string[]
}): Promise<string> {
  const admin = createAdminClient()
  const unusableSecret = newSecret()

  const { data, error } = await admin
    .from('api_keys')
    .insert({
      org_id: params.orgId,
      space_id: null,
      name: `${params.clientName}（外部チャット接続）`,
      key_hash: hashSecret(unusableSecret),
      key_prefix: 'oauth',
      created_by: params.userId,
      user_id: params.userId,
      scope: 'user',
      allowed_space_ids: null,
      allowed_actions: params.allowedActions,
      issued_via: 'oauth',
      oauth_client_id: params.clientId,
      is_active: true,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message || '接続を作れませんでした')
  return data.id
}

/** その接続を解除する（合鍵を全部止め、対応する鍵も無効にする） */
export async function revokeConnection(apiKeyId: string): Promise<void> {
  const admin = createAdminClient()
  await admin.from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('api_key_id', apiKeyId).is('revoked_at', null)
  await admin.from('api_keys').update({ is_active: false }).eq('id', apiKeyId)
}
