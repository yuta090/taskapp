import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { IntegrationConnection, IntegrationProvider } from './types'
import { encryptToken, decryptToken } from './token-crypto'

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

/**
 * DBの生行。トークンは暗号化列(access_token_encrypted/refresh_token_encrypted)から解決する
 * (contract 済み。平文列はもう select せず読まない)。平文列の型は互換のため残すが未使用。
 */
type ConnectionRow = Record<string, unknown> & {
  access_token?: string | null
  refresh_token?: string | null
  access_token_encrypted?: string | null
  refresh_token_encrypted?: string | null
}

/**
 * integration_connections から取得する列(明示指定)。平文の access_token/refresh_token は
 * **取得しない**(M2 で空化され、解決には使わない)。トークンは *_encrypted 列から復号する。
 * service_role なので M3 の列 revoke では壊れないが、平文列に依存する経路を残さないため明示する。
 */
const CONNECTION_SELECT_COLUMNS =
  'id, provider, owner_type, owner_id, org_id, token_expires_at, scopes, metadata, status, ' +
  'last_refreshed_at, created_at, updated_at, access_token_encrypted, refresh_token_encrypted'

/**
 * DB行のトークンを平文に解決して IntegrationConnection を組み立てる。
 *
 * 【contract フェーズ】暗号化列(20260717075717)*だけ* から解決する。平文列への
 * フォールバック(`?? row.access_token`)は撤去した。理由:
 *   - 暗号化列は本番全行でバックフィル済み(access/refresh とも平文と一致検証済み)。
 *   - 平文列は M2 migration で空化される。フォールバックを残すと復号失敗時に空文字を
 *     トークンとして素通ししてしまう(`??` は '' を落とさない)。
 * 復号失敗(鍵ローテ・不正blob)や暗号化列 null は「トークン無し」= null を返し、
 * 呼び出し側が再接続を促す(この設計は expand フェーズのコメントで予告済み)。
 * ここで `?? ''` のような空文字フォールバックを新設しないこと(null を返す)。
 *
 * IntegrationConnection.access_token は復号後の *平文* を返す(呼び出し側の契約を変えない)。
 * 暗号化列名がこのモジュールの外に漏れないようにするのが狙い。
 */
async function decryptConnectionRow(row: ConnectionRow): Promise<IntegrationConnection> {
  const accessToken = await decryptToken(row.access_token_encrypted)
  const refreshToken = await decryptToken(row.refresh_token_encrypted)
  return { ...row, access_token: accessToken, refresh_token: refreshToken } as IntegrationConnection
}

async function refreshIfNeededCore(connectionId: string, refreshFn: RefreshFn): Promise<RefreshCoreResult> {
  const { data: row, error } = await getSupabaseAdmin()
    .from('integration_connections')
    .select(CONNECTION_SELECT_COLUMNS)
    .eq('id', connectionId)
    .single()

  if (error || !row) {
    console.error('Failed to fetch connection for refresh:', error)
    // 接続行の読み取り自体が失敗するケース(DB瞬断・稀な競合)。何が起きたか確定できないため
    // 安全側に倒してDBを触らず一時障害として返す(誤ってexpired化しない)。
    return { status: 'transient_error' }
  }

  // decryptConnectionRow は復号の一時障害(RPC/DB error)を throw、恒久破損を null 化して返す。
  // 一時障害を expired 化しないよう transient_error に写す(誤って稼働中の接続を失効させない)。
  let connection: IntegrationConnection
  try {
    // 明示列 select は string 変数のため PostgREST の型推論が効かない。unknown 経由でキャストする。
    connection = await decryptConnectionRow(row as unknown as ConnectionRow)
  } catch {
    return { status: 'transient_error' }
  }

  // Check if token is still valid (with buffer)
  if (connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at).getTime()
    const now = Date.now()
    if (expiresAt - now > TOKEN_EXPIRY_BUFFER_MS) {
      return { status: 'valid', connection }
    }
  } else {
    // No expiry set, assume valid
    return { status: 'valid', connection }
  }

  // Token is expired or about to expire — refresh
  if (!connection.refresh_token) {
    // No refresh token, mark as expired
    await getSupabaseAdmin().from('integration_connections').update({ status: 'expired' }).eq('id', connectionId)
    return { status: 'auth_failed' }
  }

  try {
    const refreshed = await refreshFn(connection.refresh_token)

    // contractフェーズ: 平文列には実値を書かない。access_token は NOT NULL 制約を満たすため
    // 空文字で埋め、トークンの正本は暗号化列にだけ入れる。refresh 平文キーは出さない。
    // encryptTokenは失敗時にthrowする(「暗号化できなかったので平文だけ保存」に倒さない)。
    const updateData: Record<string, unknown> = {
      access_token: '',
      access_token_encrypted: await encryptToken(refreshed.accessToken),
      token_expires_at: refreshed.expiresAt ? refreshed.expiresAt.toISOString() : null,
      last_refreshed_at: new Date().toISOString(),
      status: 'active',
    }

    // 回帰修正(修正1): refresh_tokenがtruthyな時だけ上書きする。null/undefinedは
    // 「ローテートされなかった」を意味し、既存のrefresh_token_encryptedを保持する。
    if (refreshed.refreshToken) {
      updateData.refresh_token_encrypted = await encryptToken(refreshed.refreshToken)
    }

    const { data: updated, error: updateError } = await getSupabaseAdmin()
      .from('integration_connections')
      .update(updateData)
      .eq('id', connectionId)
      .select(CONNECTION_SELECT_COLUMNS)
      .single()

    if (updateError) {
      console.error('Failed to update refreshed token:', updateError)
      // 更新自体が失敗した(何も永続化されていない)。状態は変わっていないため一時障害扱い。
      return { status: 'transient_error' }
    }

    return { status: 'refreshed', connection: await decryptConnectionRow(updated as unknown as ConnectionRow) }
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
    const token = result.connection.access_token
    // 恒久破損(復号が null 化)で access_token が空/null のまま status:'ok' を返すと、
    // 呼び出し側が null/空トークンを有効とみなして外部APIへ渡してしまう。トークンが無いなら
    // auth_failed(再接続要求)に分類する。※一時障害は refreshIfNeededCore が transient_error に
    // 分類済みなのでここには来ない(=ok/token=null は恒久破損だけ)。
    if (!token) return { status: 'auth_failed' }
    return { status: 'ok', token }
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
    .select(CONNECTION_SELECT_COLUMNS)
    .eq('provider', provider)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .eq('status', 'active')
    .single()

  if (error || !data) return null
  // 復号の一時障害(throw)は「見つからない」(null)に倒す。この関数の既存契約は null|接続 で、
  // 呼び出し側(google-meet 等)は null を未接続として扱う。トークンの実解決は getValidToken 経由の
  // refreshIfNeededCore が別途行う(そこでは transient を正しく区別する)。
  try {
    return await decryptConnectionRow(data as unknown as ConnectionRow)
  } catch {
    return null
  }
}

/**
 * 接続を新規作成/更新する際のトークン列を組み立てる。
 *
 * 【contract フェーズ】平文列には実値を書かない。呼び出し側(OAuthコールバック)が生の
 * access_token/refresh_token を直接 upsert ペイロードへ書かないようにするための唯一の入口。
 * access_token 平文列は NOT NULL 制約を満たすため空文字で埋め、トークンの正本は暗号化列に
 * だけ入れる。refreshToken が null の場合は refresh_token 系のキー自体を含めない
 * (upsertのon conflict時に既存の有効なrefresh_token_encryptedを潰さないため)。
 */
export async function buildTokenColumns(params: {
  accessToken: string
  refreshToken?: string | null
}): Promise<Record<string, unknown>> {
  const columns: Record<string, unknown> = {
    access_token: '',
    access_token_encrypted: await encryptToken(params.accessToken),
  }
  if (params.refreshToken) {
    columns.refresh_token_encrypted = await encryptToken(params.refreshToken)
  }
  return columns
}
