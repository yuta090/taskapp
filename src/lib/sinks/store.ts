import { randomBytes, randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WebhookSink, DeliverableDelivery } from '@/lib/sinks/adapters/webhook'
import type { NotionSink } from '@/lib/sinks/adapters/notion'
import type { GoogleSheetsSink } from '@/lib/sinks/adapters/google_sheets'
import { isValidSpreadsheetId, isValidSheetName } from '@/lib/sinks/adapters/google_sheets'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import { refreshAccessToken } from '@/lib/google-sheets/client'

/**
 * 外部連携シンクのデータアクセス層（service role専用）。
 * integration_sinks / sink_deliveries / sink_external_refs 3表への薄いラッパー。
 * RLSはバイパスするため、org境界の絞り込みは必ずこの層の引数（呼び出し側での認可）で行う。
 */

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

function getEncryptionKey(): string {
  const key = process.env.SYSTEM_ENCRYPTION_KEY
  if (!key) throw new Error('SYSTEM_ENCRYPTION_KEY is not configured')
  return key
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`
}

async function encryptSecret(plaintext: string): Promise<string> {
  const { data, error } = await admin().rpc('encrypt_system_secret', {
    plaintext,
    secret: getEncryptionKey(),
  })
  if (error || !data) {
    throw new Error(`encrypt_system_secret failed: ${error?.message ?? 'no data'}`)
  }
  return data as string
}

/**
 * 秘密(sink の secret_encrypted / 接続の access_token_encrypted)を復号する。
 *
 * token-crypto.decryptToken と同じ思想で「一時障害」と「恒久破損」を区別する(共有せず独立に持つのは
 * この層が service_role の別クライアント admin() を使い、sink secret も復号する汎用経路のため):
 *   - RPC が error を返した → **throw**(一時的なRPC/DB障害の可能性)。呼び出し側はこれを
 *     transient_error に写して dispatcher の temporary_fail(再試行)へ載せる。null にすると
 *     一時障害が unavailable→permanent_fail→dead に化けて配達が永久に失われる(Critical)。
 *   - error は無いが data も無い → null(暗号文が復号結果を持たない=恒久破損。再接続を促す)。
 * 例外メッセージに秘密(暗号文・トークン・鍵)を一切含めないこと。
 */
async function decryptSecret(encrypted: string): Promise<string | null> {
  const { data, error } = await admin().rpc('decrypt_system_secret', {
    encrypted,
    secret: getEncryptionKey(),
  })
  if (error) throw new Error('decrypt_system_secret failed')
  if (!data) return null
  return data as string
}

/**
 * 復号/接続フェッチの一時障害(throw)を、秘密を含めずに warn ログへ出す。
 * 「単一接続だけ連続失敗 vs DB全体障害」を後から切り分けられるよう sink id / provider / 種別を
 * 残す。連続失敗回数の集計・隔離・通知は今回やらない(別PR)。ログで運用が気づけるのを最低ラインにする。
 * トークン・暗号文・鍵は絶対に出さない。
 */
function warnSinkResolveTransient(sinkId: string, provider: string, kind: 'sink_secret' | 'connection_access'): void {
  console.warn('[sink-decrypt] transient resolve failure', { sink_id: sinkId, provider, kind })
}

/**
 * 恒久破損(復号結果が空＝暗号文破損の疑い。鍵不一致/blob破損)を、秘密を含めずに warn ログへ出す。
 * これは再接続で直る恒久失敗(unavailable)だが、sink_not_deliverable だけでは「復号破損／接続不存在／
 * 設定不正」を切り分けられないため専用コードを残す。トークン・暗号文・鍵は絶対に出さない。
 */
function warnSecretCorrupt(id: string | undefined, provider: string, kind: 'sink_secret' | 'connection_access'): void {
  console.warn('[sink-decrypt] corrupt ciphertext (empty decrypt result)', {
    id,
    provider,
    kind,
    code: 'decrypt_empty_result',
  })
}

/**
 * integration_connections の access_token を平文で得る。
 *
 * 【contract フェーズ】暗号化列(20260717075717)*だけ* から解決する。平文列フォールバックは
 * 撤去済み(M2 = empty_plaintext_connection_tokens.sql で平文は '' に空化される)。
 * ここは token-manager を経由しない生SELECTの経路なので、token-manager.decryptConnectionRow と
 * 同じ解決を独立に持つ。decryptSecret は「RPC error=一時障害(throw)」「復号結果が空=恒久破損(null)」を
 * 区別する。throw は呼び出し側(findActive→toDeliverableSinkResult)が transient_error に写す。
 * 暗号化列 null / 恒久破損(null)は「トークン無し」= null を返し呼び出し側が再接続を促す。
 * `?? ''`/`?? row.access_token` のようなフォールバックを新設しないこと(平文の '' を素通しするバグ芽を残さない)。
 * この経路は service_role(createAdminClient)なので、秘密列の列レベル revoke(M3)の影響は受けない。
 */
async function resolveConnectionAccessToken(
  row: { id?: string; access_token_encrypted: string | null },
  provider: string,
): Promise<string | null> {
  if (!row.access_token_encrypted) return null
  const token = await decryptSecret(row.access_token_encrypted) // error は throw(一時障害)
  if (!token) warnSecretCorrupt(row.id, provider, 'connection_access') // 復号結果が空＝恒久破損の疑い
  return token
}

// ---------------------------------------------------------------------------
// integration_sinks
// ---------------------------------------------------------------------------

export type SinkProvider = 'webhook' | 'notion' | 'google_sheets'
export type SinkStatus = 'active' | 'disabled' | 'error'

export interface SinkMeta {
  id: string
  orgId: string
  groupId: string | null
  provider: SinkProvider
  displayName: string
  config: Record<string, unknown>
  connectionId: string | null
  events: string[]
  status: SinkStatus
  consecutiveFailures: number
  lastDeliveredAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

// secret_encrypted は列レベルgrantでauthenticatedから不可視。ここでも意図的に選択しない。
const SINK_META_COLUMNS =
  'id, org_id, group_id, provider, display_name, config, connection_id, events, status, consecutive_failures, last_delivered_at, created_by, created_at, updated_at'

interface SinkMetaRow {
  id: string
  org_id: string
  group_id: string | null
  provider: string
  display_name: string
  config: Record<string, unknown>
  connection_id: string | null
  events: string[]
  status: string
  consecutive_failures: number
  last_delivered_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

function toSinkMeta(row: SinkMetaRow): SinkMeta {
  return {
    id: row.id,
    orgId: row.org_id,
    groupId: row.group_id,
    provider: row.provider as SinkProvider,
    displayName: row.display_name,
    config: row.config,
    connectionId: row.connection_id,
    events: row.events,
    status: row.status as SinkStatus,
    consecutiveFailures: row.consecutive_failures,
    lastDeliveredAt: row.last_delivered_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// task.reopened を外すと「取り消す」（Stage 2.5）後も外部ツール側がdoneのまま残る
export const DEFAULT_SINK_EVENTS = [
  'task.created',
  'task.done',
  'task.dismissed',
  'task.reopened',
] as const
export const ALLOWED_SINK_EVENTS = [
  'task.created',
  'task.done',
  'task.dismissed',
  'task.reopened',
] as const

export interface CreateWebhookSinkInput {
  orgId: string
  groupId: string | null
  displayName: string
  url: string
  events: string[]
  createdBy: string
}

/**
 * webhookシンクを作成しsecretを一度だけ平文で返す。
 * URLのSSRF検証は呼び出し側(APIルート)がssrf.validateWebhookUrlで事前に行う。
 */
export async function createWebhookSink(
  input: CreateWebhookSinkInput,
): Promise<{ sink: SinkMeta; secret: string }> {
  const plaintextSecret = generateWebhookSecret()
  const secretEncrypted = await encryptSecret(plaintextSecret)

  const { data, error } = await admin()
    .from('integration_sinks')
    .insert({
      org_id: input.orgId,
      group_id: input.groupId,
      provider: 'webhook',
      display_name: input.displayName,
      config: { url: input.url },
      secret_encrypted: secretEncrypted,
      connection_id: null,
      events: input.events,
      created_by: input.createdBy,
    })
    .select(SINK_META_COLUMNS)
    .single()

  if (error || !data) {
    throw new Error(`integration_sinks: insert failed: ${error?.message}`)
  }
  return { sink: toSinkMeta(data as SinkMetaRow), secret: plaintextSecret }
}

export async function findSinkOrgId(sinkId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('integration_sinks')
    .select('org_id')
    .eq('id', sinkId)
    .maybeSingle()
  if (error || !data) return null
  return data.org_id as string
}

export async function findSinkMeta(sinkId: string): Promise<SinkMeta | null> {
  const { data, error } = await admin()
    .from('integration_sinks')
    .select(SINK_META_COLUMNS)
    .eq('id', sinkId)
    .maybeSingle()
  if (error || !data) return null
  return toSinkMeta(data as SinkMetaRow)
}

export async function listSinksForOrg(orgId: string): Promise<SinkMeta[]> {
  const { data, error } = await admin()
    .from('integration_sinks')
    .select(SINK_META_COLUMNS)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return (data as SinkMetaRow[]).map(toSinkMeta)
}

export interface UpdateSinkMetaInput {
  displayName?: string
  config?: Record<string, unknown>
  events?: string[]
}

export async function updateSinkMeta(
  sinkId: string,
  updates: UpdateSinkMetaInput,
): Promise<SinkMeta | null> {
  const patch: Record<string, unknown> = {}
  if (updates.displayName !== undefined) patch.display_name = updates.displayName
  if (updates.config !== undefined) patch.config = updates.config
  if (updates.events !== undefined) patch.events = updates.events
  if (Object.keys(patch).length === 0) return findSinkMeta(sinkId)

  const { data, error } = await admin()
    .from('integration_sinks')
    .update(patch)
    .eq('id', sinkId)
    .select(SINK_META_COLUMNS)
    .maybeSingle()
  if (error || !data) return null
  return toSinkMeta(data as SinkMetaRow)
}

/**
 * status='disabled' への遷移（PATCH status=disabled、DELETEの実体どちらも共通）。
 * integration_sinksの物理DELETEはDBトリガーで禁止されているため、
 * 「削除」はこの関数でstatusを落とすことで表現する。
 */
export async function disableSink(sinkId: string): Promise<SinkMeta | null> {
  const { data, error } = await admin()
    .from('integration_sinks')
    .update({ status: 'disabled' })
    .eq('id', sinkId)
    .select(SINK_META_COLUMNS)
    .maybeSingle()
  if (error || !data) return null
  return toSinkMeta(data as SinkMetaRow)
}

/**
 * disabled/error → active への再有効化。consecutive_failuresのリセットと
 * 対象deliveriesのnext_attempt_atリセットをrpc_reactivate_sinkで原子的に行う。
 */
export async function reactivateSink(sinkId: string): Promise<SinkMeta | null> {
  const { error } = await admin().rpc('rpc_reactivate_sink', { p_sink_id: sinkId })
  if (error) throw new Error(`rpc_reactivate_sink failed: ${error.message}`)
  return findSinkMeta(sinkId)
}

export async function rotateWebhookSecret(
  sinkId: string,
): Promise<{ sink: SinkMeta; secret: string } | null> {
  const plaintextSecret = generateWebhookSecret()
  const secretEncrypted = await encryptSecret(plaintextSecret)

  const { data, error } = await admin()
    .from('integration_sinks')
    .update({ secret_encrypted: secretEncrypted })
    .eq('id', sinkId)
    .eq('provider', 'webhook')
    .select(SINK_META_COLUMNS)
    .maybeSingle()

  if (error || !data) return null
  return { sink: toSinkMeta(data as SinkMetaRow), secret: plaintextSecret }
}

/** dispatcher・test送信用のprovider横断シンク型（webhookは復号済みsecret、notion/google_sheetsはアクセストークン） */
export type DeliverableSink = WebhookSink | NotionSink | GoogleSheetsSink

interface DeliverableSinkRow {
  id: string
  org_id: string
  provider: string
  config: Record<string, unknown>
  secret_encrypted: string | null
}

const DELIVERABLE_SINK_COLUMNS = 'id, org_id, provider, config, secret_encrypted'

/**
 * sink解決結果。
 *   'unavailable'       = 恒久(接続なし・config不正・復号結果が空=暗号文破損等、従来の sink_not_deliverable)。
 *   'transient_error'   = **自分側インフラ**の一時障害。全経路(webhook/notion/google_sheets)の以下を含む:
 *                         復号のRPC/DB error(throw)・接続行フェッチのDB error(throw)・
 *                         google_sheets の token 解決のうち**インフラ由来**(接続行復号 等)の一時障害。
 *                         呼び出し側は attempt を消費しない **defer** に落とす(配達を試みる前に自分の
 *                         DB/秘密が読めない障害は予算を食わせない。Fable 裁定 2026-07-23)。
 *   'transient_refresh' = **外部プロバイダ**(Google の refresh エンドポイント)への呼び出しが 5xx/
 *                         ネットワークで一時的に落ちた(getValidTokenDetailed の transientKind='refresh')。
 *                         配達先/外部起因でカテゴリが違うため、従来どおり temporary_fail(予算消費)にする。
 */
type ToDeliverableSinkResult =
  | { outcome: 'ok'; sink: DeliverableSink }
  | { outcome: 'unavailable' }
  | { outcome: 'transient_error' }
  | { outcome: 'transient_refresh' }

async function toDeliverableSinkResult(row: DeliverableSinkRow): Promise<ToDeliverableSinkResult> {
  if (row.provider === 'webhook') {
    if (!row.secret_encrypted) return { outcome: 'unavailable' }
    // 復号の一時障害(throw)は transient_error に写す(dead化させない)。恒久破損(null)は unavailable。
    let secret: string | null
    try {
      secret = await decryptSecret(row.secret_encrypted)
    } catch {
      warnSinkResolveTransient(row.id, 'webhook', 'sink_secret')
      return { outcome: 'transient_error' }
    }
    if (!secret) {
      warnSecretCorrupt(row.id, 'webhook', 'sink_secret') // 復号結果が空＝暗号文破損の疑い(恒久)
      return { outcome: 'unavailable' }
    }
    return {
      outcome: 'ok',
      sink: { id: row.id, provider: 'webhook', config: row.config as { url: string }, secret },
    }
  }
  if (row.provider === 'notion') {
    const databaseId = typeof row.config.database_id === 'string' ? row.config.database_id : ''
    if (!databaseId) return { outcome: 'unavailable' }
    // 接続トークン復号の一時障害(throw)は transient_error に写す(dead化させない)。
    // 接続が無い/revoked/恒久破損は unavailable(呼び出し側で sink_not_deliverable の恒久失敗)。
    let connection
    try {
      connection = await findActiveNotionConnection(row.org_id)
    } catch {
      warnSinkResolveTransient(row.id, 'notion', 'connection_access')
      return { outcome: 'transient_error' }
    }
    if (!connection) return { outcome: 'unavailable' }
    return {
      outcome: 'ok',
      sink: { id: row.id, provider: 'notion', accessToken: connection.accessToken, databaseId },
    }
  }
  if (row.provider === 'google_sheets') {
    const spreadsheetId = typeof row.config.spreadsheet_id === 'string' ? row.config.spreadsheet_id : ''
    const sheetName = typeof row.config.sheet_name === 'string' ? row.config.sheet_name : ''
    if (!isValidSpreadsheetId(spreadsheetId) || !isValidSheetName(sheetName)) return { outcome: 'unavailable' }
    // 接続の解決(暗号列の復号)一時障害(throw)は transient_error に写す(dead化させない)。
    let connection
    try {
      connection = await findActiveGoogleSheetsConnection(row.org_id)
    } catch {
      warnSinkResolveTransient(row.id, 'google_sheets', 'connection_access')
      return { outcome: 'transient_error' }
    }
    if (!connection) return { outcome: 'unavailable' }
    // Googleのアクセストークンは1時間で失効するため、生のaccess_token列を直接使わず
    // token-managerでrefresh込みの有効なトークンを都度解決する(notionは無期限トークンのため不要)。
    // 詳細版(getValidTokenDetailed)を使い、失効(auth_failed)と一時障害(transient_error)を
    // 区別する。一時障害はsink_not_deliverable(恒久)にせず、呼び出し側で再試行に回す
    // (レビュー回帰対応: refreshのtemporary障害でsinkを恒久に殺さない)。
    const result = await getValidTokenDetailed(connection.id, refreshAccessToken)
    if (result.status === 'transient_error') {
      // 外部refresh起因(transientKind='refresh')は従来どおり temporary_fail(予算消費)。
      // インフラ由来(kind 不在: 接続行復号の瞬断等)は attempt を消費しない defer に回す。
      return { outcome: result.transientKind === 'refresh' ? 'transient_refresh' : 'transient_error' }
    }
    if (result.status !== 'ok') return { outcome: 'unavailable' }
    return {
      outcome: 'ok',
      sink: { id: row.id, provider: 'google_sheets', accessToken: result.token, spreadsheetId, sheetName },
    }
  }
  return { outcome: 'unavailable' }
}

/**
 * dispatcher・test送信用: 配達可能な形にした単一シンク（webhook/notion/google_sheets）。
 * transient_errorも含め、resolveできなければnullを返す(単発のテスト配達はユーザーが
 * 手動で再試行できるため、恒久/一時の区別をここでは呼び出し元に返さない)。
 */
export async function findDeliverableSink(sinkId: string): Promise<DeliverableSink | null> {
  const { data, error } = await admin()
    .from('integration_sinks')
    .select(DELIVERABLE_SINK_COLUMNS)
    .eq('id', sinkId)
    .maybeSingle()
  if (error || !data) return null
  const result = await toDeliverableSinkResult(data as DeliverableSinkRow)
  return result.outcome === 'ok' ? result.sink : null
}

export interface DeliverableSinksResolution {
  sinks: Map<string, DeliverableSink>
  /** **自分側インフラ**の一時障害(復号RPC/DB read の瞬断等)で解決に失敗した sinkId。
   *  dispatcher 側で **defer**(attempt を消費せず 5分後に再試行)として扱う。
   *  sinks にも refreshTransientSinkIds にも unavailable にも含まれない(排他)。 */
  transientSinkIds: Set<string>
  /** **外部refresh**起因(Google の refresh 5xx/ネットワーク)の一時障害で解決に失敗した sinkId。
   *  dispatcher 側で従来どおり temporary_fail(予算消費・バックオフ)として扱う。transientSinkIds と排他。 */
  refreshTransientSinkIds: Set<string>
}

/** dispatch用: 複数sinkIdの配達可能シンクをまとめて取得する（重複sink_idを1回で解決） */
export async function findDeliverableSinksByIds(sinkIds: string[]): Promise<DeliverableSinksResolution> {
  const uniqueIds = Array.from(new Set(sinkIds))
  if (uniqueIds.length === 0) {
    return { sinks: new Map(), transientSinkIds: new Set(), refreshTransientSinkIds: new Set() }
  }

  const { data, error } = await admin()
    .from('integration_sinks')
    .select(DELIVERABLE_SINK_COLUMNS)
    .in('id', uniqueIds)
  if (error || !data) {
    // sink一覧の読み取り自体が一時失敗した(=自分側インフラの瞬断)。0件(=このバッチの claim 済み配達が
    // 全部 permanent_fail→dead)に倒さず、バッチ全体を infra transient にして **defer**(attempt を消費せず
    // 次サイクルで再試行)へ載せる。「一時障害を恒久失敗に化けさせない」の一貫(Critical)。秘密は含めない。
    console.warn('[sink-list] transient DB read failure; treating batch as deferrable', {
      requested: uniqueIds.length,
    })
    return { sinks: new Map(), transientSinkIds: new Set(uniqueIds), refreshTransientSinkIds: new Set() }
  }

  const rows = data as DeliverableSinkRow[]

  const entries = await Promise.all(
    rows.map(async (row) => [row.id, await toDeliverableSinkResult(row)] as const),
  )

  const sinks = new Map<string, DeliverableSink>()
  const transientSinkIds = new Set<string>()
  const refreshTransientSinkIds = new Set<string>()
  for (const [id, result] of entries) {
    if (result.outcome === 'ok') sinks.set(id, result.sink)
    else if (result.outcome === 'transient_error') transientSinkIds.add(id)
    else if (result.outcome === 'transient_refresh') refreshTransientSinkIds.add(id)
  }
  return { sinks, transientSinkIds, refreshTransientSinkIds }
}

// ---------------------------------------------------------------------------
// integration_connections — Notion（org単位1ワークスペース、provider='notion' owner_type='org'）
// ---------------------------------------------------------------------------

export interface NotionConnectionInfo {
  id: string
  accessToken: string
  workspaceName: string | null
}

/** orgのactiveなNotion接続を1件返す（unique(provider,owner_type,owner_id)によりorgあたり最大1件） */
export async function findActiveNotionConnection(orgId: string): Promise<NotionConnectionInfo | null> {
  const { data, error } = await admin()
    .from('integration_connections')
    // contract: 平文 access_token 列は読まない(M2 で空化)。トークンは暗号化列から復号する。
    .select('id, access_token_encrypted, metadata')
    .eq('provider', 'notion')
    .eq('owner_type', 'org')
    .eq('owner_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  // DB error(一時障害)は throw して呼び出し側(toDeliverableSinkResult)で transient_error に写す。
  // row 不在(error 無し・data 無し=接続が存在しない)は従来どおり null(恒久=unavailable)。
  if (error) throw new Error('integration_connections read failed')
  if (!data) return null
  const row = data as {
    id: string
    access_token_encrypted: string | null
    metadata: Record<string, unknown> | null
  }
  const accessToken = await resolveConnectionAccessToken(row, 'notion')
  if (!accessToken) return null
  const metadata = row.metadata ?? {}
  return {
    id: row.id,
    accessToken,
    workspaceName: typeof metadata.workspace_name === 'string' ? metadata.workspace_name : null,
  }
}

export interface CreateNotionSinkInput {
  orgId: string
  groupId: string | null
  displayName: string
  databaseId: string
  connectionId: string
  events: string[]
  createdBy: string
}

/**
 * notionシンクを作成する。webhookと異なりsecretは持たない(connection_id経由でaccess_tokenを参照)
 * ためsecret_encryptedはnull。レスポンスに秘匿情報を含める必要がない。
 */
export async function createNotionSink(input: CreateNotionSinkInput): Promise<SinkMeta> {
  const { data, error } = await admin()
    .from('integration_sinks')
    .insert({
      org_id: input.orgId,
      group_id: input.groupId,
      provider: 'notion',
      display_name: input.displayName,
      config: { database_id: input.databaseId },
      secret_encrypted: null,
      connection_id: input.connectionId,
      events: input.events,
      created_by: input.createdBy,
    })
    .select(SINK_META_COLUMNS)
    .single()

  if (error || !data) {
    throw new Error(`integration_sinks: insert failed: ${error?.message}`)
  }
  return toSinkMeta(data as SinkMetaRow)
}

// ---------------------------------------------------------------------------
// integration_connections — Google Sheets（org単位、provider='google_sheets' owner_type='org'）
// ---------------------------------------------------------------------------

export interface GoogleSheetsConnectionInfo {
  id: string
  accessToken: string
}

/**
 * orgのactiveなGoogle Sheets接続を1件返す（unique(provider,owner_type,owner_id)によりorgあたり最大1件）。
 * ここで返すaccessTokenはUI表示(接続可否のみ)向けで、失効している可能性がある。実配達では
 * 必ずconnection.id経由でtoken-manager.getValidTokenDetailedをもう一段呼び、refresh込みで解決する
 * (Notionは無期限トークンのためこの二段構えが不要な違い)。
 */
export async function findActiveGoogleSheetsConnection(
  orgId: string,
): Promise<GoogleSheetsConnectionInfo | null> {
  const { data, error } = await admin()
    .from('integration_connections')
    // contract: 平文 access_token 列は読まない(M2 で空化)。トークンは暗号化列から復号する。
    .select('id, access_token_encrypted')
    .eq('provider', 'google_sheets')
    .eq('owner_type', 'org')
    .eq('owner_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  // DB error(一時障害)は throw、row 不在(恒久=接続なし)は null(notion と同じ扱い)。
  if (error) throw new Error('integration_connections read failed')
  if (!data) return null
  const row = data as { id: string; access_token_encrypted: string | null }
  const accessToken = await resolveConnectionAccessToken(row, 'google_sheets')
  if (!accessToken) return null
  return { id: row.id, accessToken }
}

export interface CreateGoogleSheetsSinkInput {
  orgId: string
  groupId: string | null
  displayName: string
  spreadsheetId: string
  sheetName: string
  connectionId: string
  events: string[]
  createdBy: string
}

/**
 * google_sheetsシンクを作成する。notionと同様にsecretは持たない(connection_id経由で
 * access_tokenを参照する)ためsecret_encryptedはnull。
 */
export async function createGoogleSheetsSink(input: CreateGoogleSheetsSinkInput): Promise<SinkMeta> {
  const { data, error } = await admin()
    .from('integration_sinks')
    .insert({
      org_id: input.orgId,
      group_id: input.groupId,
      provider: 'google_sheets',
      display_name: input.displayName,
      config: { spreadsheet_id: input.spreadsheetId, sheet_name: input.sheetName },
      secret_encrypted: null,
      connection_id: input.connectionId,
      events: input.events,
      created_by: input.createdBy,
    })
    .select(SINK_META_COLUMNS)
    .single()

  if (error || !data) {
    throw new Error(`integration_sinks: insert failed: ${error?.message}`)
  }
  return toSinkMeta(data as SinkMetaRow)
}

// ---------------------------------------------------------------------------
// sink_external_refs — Notion外部オブジェクト対応表(§1-3)
// ---------------------------------------------------------------------------

export async function findExternalRef(sinkId: string, digestTaskId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('sink_external_refs')
    .select('external_ref')
    .eq('sink_id', sinkId)
    .eq('digest_task_id', digestTaskId)
    .maybeSingle()
  if (error || !data) return null
  return (data as { external_ref: string }).external_ref
}

export type SaveExternalRefResult =
  | { outcome: 'inserted' }
  | { outcome: 'conflict'; existingRef: string }

/**
 * refをinsertする。unique(sink_id, digest_task_id)への競合(23505、並行配達で
 * 別の遷移が先にrefを確定させた場合)は既存refを読み直してoutcome:'conflict'で返す
 * （呼び出し側のadapterはそちらのページをPATCHでフォールバック更新する）。
 */
export async function saveExternalRef(
  sinkId: string,
  digestTaskId: string,
  externalRef: string,
): Promise<SaveExternalRefResult> {
  const { error } = await admin()
    .from('sink_external_refs')
    .insert({ sink_id: sinkId, digest_task_id: digestTaskId, external_ref: externalRef })
  if (!error) return { outcome: 'inserted' }
  if ((error as { code?: string }).code === '23505') {
    const existing = await findExternalRef(sinkId, digestTaskId)
    if (existing) return { outcome: 'conflict', existingRef: existing }
  }
  throw new Error(`sink_external_refs: insert failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// sink_deliveries — dispatch
// ---------------------------------------------------------------------------

export interface ClaimedDelivery {
  id: string
  orgId: string
  sinkId: string
  digestTaskId: string | null
  eventType: string
  eventKey: string
  payload: DeliverableDelivery['payload']
  attempts: number
}

interface DeliveryRow {
  id: string
  org_id: string
  sink_id: string
  digest_task_id: string | null
  event_type: string
  event_key: string
  payload: DeliverableDelivery['payload']
  attempts: number
}

function toClaimedDelivery(row: DeliveryRow): ClaimedDelivery {
  return {
    id: row.id,
    orgId: row.org_id,
    sinkId: row.sink_id,
    digestTaskId: row.digest_task_id,
    eventType: row.event_type,
    eventKey: row.event_key,
    payload: row.payload,
    attempts: row.attempts,
  }
}

export async function claimSinkDeliveries(
  totalLimit = 100,
  perSinkLimit = 10,
): Promise<ClaimedDelivery[]> {
  const { data, error } = await admin().rpc('rpc_claim_sink_deliveries', {
    p_total_limit: totalLimit,
    p_per_sink_limit: perSinkLimit,
  })
  if (error) throw new Error(`rpc_claim_sink_deliveries failed: ${error.message}`)
  return ((data as DeliveryRow[]) ?? []).map(toClaimedDelivery)
}

// 'defer' = 自分側インフラの一時障害。attempt を消費せず 5分後に再試行する(dead 化させない)。
// consecutive_failures は加算し、20連続で sink 自動停止(circuit breaker)へ収束する(RPC 側で実装)。
export type DeliveryOutcome = 'sent' | 'temporary_fail' | 'permanent_fail' | 'defer'

export interface CompleteSinkDeliveryInput {
  deliveryId: string
  outcome: DeliveryOutcome
  responseStatus?: number
  error?: string
  countsTowardFailures: boolean
}

export interface CompleteSinkDeliveryResult {
  deliveryStatus: string
  sinkStatus: SinkStatus
  consecutiveFailures: number
  justBecameError: boolean
}

export async function completeSinkDelivery(
  input: CompleteSinkDeliveryInput,
): Promise<CompleteSinkDeliveryResult> {
  const { data, error } = await admin().rpc('rpc_complete_sink_delivery', {
    p_delivery_id: input.deliveryId,
    p_outcome: input.outcome,
    p_response_status: input.responseStatus ?? null,
    p_error: input.error ?? null,
    p_counts_toward_failures: input.countsTowardFailures,
  })
  if (error) throw new Error(`rpc_complete_sink_delivery failed: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as {
    delivery_status: string
    sink_status: string
    consecutive_failures: number
    just_became_error: boolean
  }
  return {
    deliveryStatus: row.delivery_status,
    sinkStatus: row.sink_status as SinkStatus,
    consecutiveFailures: row.consecutive_failures,
    justBecameError: row.just_became_error,
  }
}

export async function redeliverDelivery(deliveryId: string): Promise<boolean> {
  const { data, error } = await admin().rpc('rpc_redeliver_sink_delivery', {
    p_delivery_id: deliveryId,
  })
  if (error) throw new Error(`rpc_redeliver_sink_delivery failed: ${error.message}`)
  return !!data
}

export async function redeliverSink(sinkId: string): Promise<number> {
  const { data, error } = await admin().rpc('rpc_redeliver_sink', { p_sink_id: sinkId })
  if (error) throw new Error(`rpc_redeliver_sink failed: ${error.message}`)
  return (data as number) ?? 0
}

export interface DisabledStaleSink {
  sinkId: string
  orgId: string
  displayName: string
}

/**
 * グループ再リンク（新世代作成）時に旧世代 group_id を向いていた active な sink を
 * disable する（受け入れ基準12）。呼び出し側（webhookHandler）は返り値を使って
 * org owner/adminへ通知する。旧世代が無ければ空配列（例外にしない）。
 */
export async function disableStaleGroupSinks(newGroupId: string): Promise<DisabledStaleSink[]> {
  const { data, error } = await admin().rpc('rpc_disable_stale_group_sinks', {
    p_new_group_id: newGroupId,
  })
  if (error) throw new Error(`rpc_disable_stale_group_sinks failed: ${error.message}`)
  return ((data as Array<{ out_sink_id: string; out_org_id: string; out_display_name: string }>) ?? []).map(
    (row) => ({ sinkId: row.out_sink_id, orgId: row.out_org_id, displayName: row.out_display_name }),
  )
}

/** テスト配達(event: 'ping')。dispatcherの通常キューを経由せず即時処理する前提の行を作る */
export async function insertPingDelivery(sink: {
  id: string
  orgId: string
}): Promise<ClaimedDelivery> {
  // occurred_at はプロトコル上のUTCタイムスタンプ(JSONペイロード)であり、
  // 表示用ローカル日付ではないため toISOString() 禁止ルールの対象外
  // （CLAUDE.md: 「HTTPヘッダ/署名タイムスタンプ等UTCが正しい箇所はunix秒でよい」の同種例外）。
  const occurredAt = new Date().toISOString()
  const eventKey = `ping:${randomUUID()}`

  const { data, error } = await admin()
    .from('sink_deliveries')
    .insert({
      org_id: sink.orgId,
      sink_id: sink.id,
      digest_task_id: null,
      event_type: 'ping',
      event_key: eventKey,
      payload: { occurred_at: occurredAt, task: null },
    })
    .select('id, org_id, sink_id, digest_task_id, event_type, event_key, payload, attempts')
    .single()

  if (error || !data) {
    throw new Error(`sink_deliveries: ping insert failed: ${error?.message}`)
  }
  return toClaimedDelivery(data as DeliveryRow)
}

// ---------------------------------------------------------------------------
// sink_deliveries — ログ閲覧
// ---------------------------------------------------------------------------

export interface DeliveryLogEntry {
  id: string
  sinkId: string
  digestTaskId: string | null
  eventType: string
  eventKey: string
  status: 'queued' | 'sent' | 'failed' | 'dead'
  attempts: number
  nextAttemptAt: string
  lastError: string | null
  responseStatus: number | null
  createdAt: string
  deliveredAt: string | null
}

const DELIVERY_LOG_COLUMNS =
  'id, sink_id, digest_task_id, event_type, event_key, status, attempts, next_attempt_at, last_error, response_status, created_at, delivered_at'

interface DeliveryLogRow {
  id: string
  sink_id: string
  digest_task_id: string | null
  event_type: string
  event_key: string
  status: string
  attempts: number
  next_attempt_at: string
  last_error: string | null
  response_status: number | null
  created_at: string
  delivered_at: string | null
}

function toDeliveryLogEntry(row: DeliveryLogRow): DeliveryLogEntry {
  return {
    id: row.id,
    sinkId: row.sink_id,
    digestTaskId: row.digest_task_id,
    eventType: row.event_type,
    eventKey: row.event_key,
    status: row.status as DeliveryLogEntry['status'],
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    responseStatus: row.response_status,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  }
}

export interface ListDeliveriesInput {
  orgId: string
  sinkId?: string
  taskId?: string
  limit?: number
  beforeCreatedAt?: string
}

export async function listDeliveries(input: ListDeliveriesInput): Promise<DeliveryLogEntry[]> {
  let query = admin()
    .from('sink_deliveries')
    .select(DELIVERY_LOG_COLUMNS)
    .eq('org_id', input.orgId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 50)

  if (input.sinkId) query = query.eq('sink_id', input.sinkId)
  if (input.taskId) query = query.eq('digest_task_id', input.taskId)
  if (input.beforeCreatedAt) query = query.lt('created_at', input.beforeCreatedAt)

  const { data, error } = await query
  if (error || !data) return []
  return (data as DeliveryLogRow[]).map(toDeliveryLogEntry)
}

export async function findDeliveryOrgId(deliveryId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('sink_deliveries')
    .select('org_id')
    .eq('id', deliveryId)
    .maybeSingle()
  if (error || !data) return null
  return data.org_id as string
}

export async function findDeliverySinkId(deliveryId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('sink_deliveries')
    .select('sink_id')
    .eq('id', deliveryId)
    .maybeSingle()
  if (error || !data) return null
  return data.sink_id as string
}

/** コンソールのsink一覧カード用: sinkごとの直近配達1件（無ければnull） */
export async function findLatestDeliveryStatusForOrg(
  orgId: string,
): Promise<Map<string, { status: string; eventType: string; createdAt: string }>> {
  const { data, error } = await admin()
    .from('sink_deliveries')
    .select('sink_id, status, event_type, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(500)

  const map = new Map<string, { status: string; eventType: string; createdAt: string }>()
  if (error || !data) return map

  for (const row of data as Array<{
    sink_id: string
    status: string
    event_type: string
    created_at: string
  }>) {
    if (!map.has(row.sink_id)) {
      map.set(row.sink_id, { status: row.status, eventType: row.event_type, createdAt: row.created_at })
    }
  }
  return map
}
