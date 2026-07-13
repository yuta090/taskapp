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

async function decryptSecret(encrypted: string): Promise<string | null> {
  const { data, error } = await admin().rpc('decrypt_system_secret', {
    encrypted,
    secret: getEncryptionKey(),
  })
  if (error || !data) return null
  return data as string
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
 * sink解決結果。'unavailable' は恒久(接続なし・config不正・secret復号失敗等、従来の
 * sink_not_deliverable)、'transient_error' はGoogle Sheetsのtoken refreshが5xx/ネットワーク等の
 * 一時障害で失敗したケース(呼び出し側でtemporary_fail=再試行に落とす。レビュー回帰対応)。
 */
type ToDeliverableSinkResult =
  | { outcome: 'ok'; sink: DeliverableSink }
  | { outcome: 'unavailable' }
  | { outcome: 'transient_error' }

async function toDeliverableSinkResult(row: DeliverableSinkRow): Promise<ToDeliverableSinkResult> {
  if (row.provider === 'webhook') {
    if (!row.secret_encrypted) return { outcome: 'unavailable' }
    const secret = await decryptSecret(row.secret_encrypted)
    if (!secret) return { outcome: 'unavailable' }
    return {
      outcome: 'ok',
      sink: { id: row.id, provider: 'webhook', config: row.config as { url: string }, secret },
    }
  }
  if (row.provider === 'notion') {
    const databaseId = typeof row.config.database_id === 'string' ? row.config.database_id : ''
    if (!databaseId) return { outcome: 'unavailable' }
    // 接続が無い/revokedのnotion sinkは配達不能(呼び出し側でsink_not_deliverableの恒久失敗になる)
    const connection = await findActiveNotionConnection(row.org_id)
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
    const connection = await findActiveGoogleSheetsConnection(row.org_id)
    if (!connection) return { outcome: 'unavailable' }
    // Googleのアクセストークンは1時間で失効するため、生のaccess_token列を直接使わず
    // token-managerでrefresh込みの有効なトークンを都度解決する(notionは無期限トークンのため不要)。
    // 詳細版(getValidTokenDetailed)を使い、失効(auth_failed)と一時障害(transient_error)を
    // 区別する。一時障害はsink_not_deliverable(恒久)にせず、呼び出し側で再試行に回す
    // (レビュー回帰対応: refreshのtemporary障害でsinkを恒久に殺さない)。
    const result = await getValidTokenDetailed(connection.id, refreshAccessToken)
    if (result.status === 'transient_error') return { outcome: 'transient_error' }
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
  /** google_sheetsのtoken refreshが一時障害で失敗したsinkId。dispatcher側でtemporary_fail
   *  (再試行)として扱う。sinksにもunavailable集合にも含まれない(排他)。 */
  transientSinkIds: Set<string>
}

/** dispatch用: 複数sinkIdの配達可能シンクをまとめて取得する（重複sink_idを1回で解決） */
export async function findDeliverableSinksByIds(sinkIds: string[]): Promise<DeliverableSinksResolution> {
  const uniqueIds = Array.from(new Set(sinkIds))
  if (uniqueIds.length === 0) return { sinks: new Map(), transientSinkIds: new Set() }

  const { data, error } = await admin()
    .from('integration_sinks')
    .select(DELIVERABLE_SINK_COLUMNS)
    .in('id', uniqueIds)
  if (error || !data) return { sinks: new Map(), transientSinkIds: new Set() }

  const rows = data as DeliverableSinkRow[]

  const entries = await Promise.all(
    rows.map(async (row) => [row.id, await toDeliverableSinkResult(row)] as const),
  )

  const sinks = new Map<string, DeliverableSink>()
  const transientSinkIds = new Set<string>()
  for (const [id, result] of entries) {
    if (result.outcome === 'ok') sinks.set(id, result.sink)
    else if (result.outcome === 'transient_error') transientSinkIds.add(id)
  }
  return { sinks, transientSinkIds }
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
    .select('id, access_token, metadata')
    .eq('provider', 'notion')
    .eq('owner_type', 'org')
    .eq('owner_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  if (error || !data) return null
  const row = data as { id: string; access_token: string; metadata: Record<string, unknown> | null }
  const metadata = row.metadata ?? {}
  return {
    id: row.id,
    accessToken: row.access_token,
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
    .select('id, access_token')
    .eq('provider', 'google_sheets')
    .eq('owner_type', 'org')
    .eq('owner_id', orgId)
    .eq('status', 'active')
    .maybeSingle()
  if (error || !data) return null
  const row = data as { id: string; access_token: string }
  return { id: row.id, accessToken: row.access_token }
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

export type DeliveryOutcome = 'sent' | 'temporary_fail' | 'permanent_fail'

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
