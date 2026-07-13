import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * チャネル配管のデータアクセス層（service role専用）。
 * channel_* 4表と channel-attachments バケットへの薄いラッパー。
 * RLSはバイパスするため、org境界の絞り込みは必ずこの層の引数で行う。
 */

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

function getEncryptionKey(): string {
  const key = process.env.SYSTEM_ENCRYPTION_KEY
  if (!key) throw new Error('SYSTEM_ENCRYPTION_KEY is not configured')
  return key
}

// ---------------------------------------------------------------------------
// channel_accounts
// ---------------------------------------------------------------------------

export interface LineAccount {
  id: string
  orgId: string
  displayName: string
  channelSecret: string
  accessToken: string
  status: 'active' | 'disabled'
}

interface AccountRow {
  id: string
  org_id: string
  display_name: string
  credentials_encrypted: string
  status: string
}

async function decryptAccount(row: AccountRow): Promise<LineAccount | null> {
  const { data: decrypted, error } = await admin().rpc('decrypt_system_secret', {
    encrypted: row.credentials_encrypted,
    secret: getEncryptionKey(),
  })
  if (error || !decrypted) {
    console.error('channel_accounts: failed to decrypt credentials', row.id, error)
    return null
  }
  let credentials: { channel_secret?: string; access_token?: string }
  try {
    credentials = JSON.parse(decrypted as string)
  } catch {
    console.error('channel_accounts: credentials are not valid JSON', row.id)
    return null
  }
  if (!credentials.channel_secret || !credentials.access_token) return null
  return {
    id: row.id,
    orgId: row.org_id,
    displayName: row.display_name,
    channelSecret: credentials.channel_secret,
    accessToken: credentials.access_token,
    status: row.status === 'disabled' ? 'disabled' : 'active',
  }
}

/**
 * destination(=bot userId)からアカウントを逆引きする。
 * status='disabled'でも返す — disabled中もinboundの記録は続ける必要があるため
 * （止まるのは自動応答・digest・送信APIのみ。§1参照）。
 */
export async function findLineAccountByDestination(
  destination: string,
): Promise<LineAccount | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id, org_id, display_name, credentials_encrypted, status')
    .eq('channel', 'line')
    .eq('line_bot_user_id', destination)
    .maybeSingle()

  if (error || !data) return null
  return decryptAccount(data as AccountRow)
}

export async function findLineAccountById(accountId: string): Promise<LineAccount | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id, org_id, display_name, credentials_encrypted, status')
    .eq('id', accountId)
    .maybeSingle()

  if (error || !data) return null
  return decryptAccount(data as AccountRow)
}

export interface LineAccountLookup {
  id: string
  status: 'active' | 'disabled'
  /** status='active' かつ復号成功のときのみ非null */
  account: LineAccount | null
}

/**
 * 送信前の409分岐用: 1クエリで存在確認とstatus判定を済ませる。
 * disabled(記録は続けるが自動応答/送信は止める)は復号せずに返し、無駄なdecrypt呼び出しを避ける。
 */
export async function findLineAccountForOrg(orgId: string): Promise<LineAccountLookup | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id, org_id, display_name, credentials_encrypted, status')
    .eq('channel', 'line')
    .eq('org_id', orgId)
    .maybeSingle()

  if (error || !data) return null

  const row = data as AccountRow & { status: string }
  const status = row.status as 'active' | 'disabled'
  if (status !== 'active') {
    return { id: row.id, status, account: null }
  }

  const account = await decryptAccount(row)
  return { id: row.id, status, account }
}

export interface ChannelAccountMeta {
  id: string
  orgId: string
  channel: string
  displayName: string
  lineBotUserId: string | null
  status: 'active' | 'disabled'
  createdAt: string
}

const ACCOUNT_META_COLUMNS = 'id, org_id, channel, display_name, line_bot_user_id, status, created_at'

interface AccountMetaRow {
  id: string
  org_id: string
  channel: string
  display_name: string
  line_bot_user_id: string | null
  status: string
  created_at: string
}

function toAccountMeta(row: AccountMetaRow): ChannelAccountMeta {
  return {
    id: row.id,
    orgId: row.org_id,
    channel: row.channel,
    displayName: row.display_name,
    lineBotUserId: row.line_bot_user_id,
    status: row.status as 'active' | 'disabled',
    createdAt: row.created_at,
  }
}

/** コンソールのbot状態カード用。credentials_encryptedは絶対に選択しない */
export async function findChannelAccountMetaForOrg(orgId: string): Promise<ChannelAccountMeta | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select(ACCOUNT_META_COLUMNS)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return toAccountMeta(data as AccountMetaRow)
}

/** PATCH /api/channels/accounts の認可用: accountIdの実所属orgを引く(クライアント申告のorgIdは信用しない) */
export async function findChannelAccountOrgId(accountId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('org_id')
    .eq('id', accountId)
    .maybeSingle()

  if (error || !data) return null
  return data.org_id as string
}

export async function updateChannelAccountStatus(
  accountId: string,
  status: 'active' | 'disabled',
): Promise<ChannelAccountMeta | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .select(ACCOUNT_META_COLUMNS)
    .maybeSingle()

  if (error || !data) return null
  return toAccountMeta(data as AccountMetaRow)
}

// ---------------------------------------------------------------------------
// channel_identities
// ---------------------------------------------------------------------------

export interface ActiveIdentity {
  id: string
  spaceId: string
}

export async function findActiveLineIdentities(
  orgId: string,
  externalUserId: string,
): Promise<ActiveIdentity[]> {
  const { data, error } = await admin()
    .from('channel_identities')
    .select('id, space_id')
    .eq('org_id', orgId)
    .eq('channel', 'line')
    .eq('external_id', externalUserId)
    .eq('status', 'active')

  if (error || !data) return []
  return data.map((row) => ({ id: row.id as string, spaceId: row.space_id as string }))
}

export async function findActiveIdentityForSpace(
  orgId: string,
  spaceId: string,
  channel: string,
): Promise<{ id: string; externalId: string } | null> {
  const { data, error } = await admin()
    .from('channel_identities')
    .select('id, external_id')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .eq('channel', channel)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return { id: data.id as string, externalId: data.external_id as string }
}

// ---------------------------------------------------------------------------
// channel_link_codes
// ---------------------------------------------------------------------------

export interface ValidLinkCode {
  id: string
  orgId: string
  spaceId: string
  firstUsedAt: string | null
}

export async function findValidLinkCode(code: string): Promise<ValidLinkCode | null> {
  const { data, error } = await admin()
    .from('channel_link_codes')
    .select('id, org_id, space_id, first_used_at')
    .eq('code', code)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id as string,
    orgId: data.org_id as string,
    spaceId: data.space_id as string,
    firstUsedAt: data.first_used_at as string | null,
  }
}

export interface CreateLinkCodeInput {
  orgId: string
  spaceId: string
  code: string
  createdBy: string
}

/** コード衝突（unique違反）のとき投げる。呼び出し側はこれに限りリトライしてよい */
export class DuplicateLinkCodeError extends Error {
  constructor() {
    super('link code collision')
    this.name = 'DuplicateLinkCodeError'
  }
}

export async function verifySpaceInOrg(orgId: string, spaceId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('spaces')
    .select('id')
    .eq('id', spaceId)
    .eq('org_id', orgId)
    .maybeSingle()
  return !error && !!data
}

export async function createLinkCode(
  input: CreateLinkCodeInput,
): Promise<{ id: string; code: string; expiresAt: string }> {
  const { data, error } = await admin()
    .from('channel_link_codes')
    .insert({
      org_id: input.orgId,
      space_id: input.spaceId,
      channel: 'line',
      code: input.code,
      created_by: input.createdBy,
    })
    .select('id, code, expires_at')
    .single()

  if (error || !data) {
    if (error?.code === '23505') throw new DuplicateLinkCodeError()
    throw new Error(`channel_link_codes: insert failed: ${error?.message}`)
  }
  return { id: data.id as string, code: data.code as string, expiresAt: data.expires_at as string }
}

/**
 * リンクコードで identity を作成（期限内マルチユース）。
 * 同一人物×同一spaceで既にactiveなら既存を返す（再送や2台目端末）。
 */
export async function linkIdentityViaCode(
  linkCode: ValidLinkCode,
  externalUserId: string,
): Promise<ActiveIdentity> {
  const client = admin()
  const { data, error } = await client
    .from('channel_identities')
    .insert({
      org_id: linkCode.orgId,
      space_id: linkCode.spaceId,
      channel: 'line',
      external_id: externalUserId,
      linked_via: 'link_code',
      link_code_id: linkCode.id,
    })
    .select('id, space_id')
    .single()

  let identity: ActiveIdentity
  if (error) {
    if (error.code !== '23505') {
      throw new Error(`channel_identities: insert failed: ${error.message}`)
    }
    // 既にactiveの紐付けがある → 既存を返す
    const { data: existing } = await client
      .from('channel_identities')
      .select('id, space_id')
      .eq('org_id', linkCode.orgId)
      .eq('space_id', linkCode.spaceId)
      .eq('channel', 'line')
      .eq('external_id', externalUserId)
      .eq('status', 'active')
      .single()
    if (!existing) throw new Error('channel_identities: conflict but active row not found')
    identity = { id: existing.id as string, spaceId: existing.space_id as string }
  } else {
    identity = { id: data!.id as string, spaceId: data!.space_id as string }
  }

  if (!linkCode.firstUsedAt) {
    await client
      .from('channel_link_codes')
      .update({ first_used_at: new Date().toISOString() })
      .eq('id', linkCode.id)
      .is('first_used_at', null)
  }

  return identity
}

// ---------------------------------------------------------------------------
// channel_groups
// ---------------------------------------------------------------------------

export type PickupMode = 'all' | 'mention_only' | 'off'

export interface ChannelGroup {
  id: string
  orgId: string
  spaceId: string | null
  accountId: string
  externalGroupId: string
  displayName: string | null
  status: 'active' | 'left'
  /** 申し送りの拾い方（Stage 2.5 §1）。digest_enabled列は廃止・読み書きしない */
  pickupMode: PickupMode
  lastExtractedMessageCreatedAt: string | null
}

interface GroupRow {
  id: string
  org_id: string
  space_id: string | null
  account_id: string
  external_group_id: string
  display_name: string | null
  status: string
  pickup_mode: string
  last_extracted_message_created_at: string | null
}

function toPickupMode(value: string): PickupMode {
  return value === 'mention_only' || value === 'off' ? value : 'all'
}

function toChannelGroup(row: GroupRow): ChannelGroup {
  return {
    id: row.id,
    orgId: row.org_id,
    spaceId: row.space_id,
    accountId: row.account_id,
    externalGroupId: row.external_group_id,
    displayName: row.display_name,
    status: row.status === 'left' ? 'left' : 'active',
    pickupMode: toPickupMode(row.pickup_mode),
    lastExtractedMessageCreatedAt: row.last_extracted_message_created_at,
  }
}

const GROUP_COLUMNS =
  'id, org_id, space_id, account_id, external_group_id, display_name, status, pickup_mode, last_extracted_message_created_at'

export async function findActiveGroup(
  accountId: string,
  externalGroupId: string,
): Promise<ChannelGroup | null> {
  const { data, error } = await admin()
    .from('channel_groups')
    .select(GROUP_COLUMNS)
    .eq('account_id', accountId)
    .eq('external_group_id', externalGroupId)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) return null
  return toChannelGroup(data as GroupRow)
}

/**
 * join時に呼ぶ: activeな世代が既にあればそれを返し（冪等）、無ければ新世代を作る。
 * 世代方式のため、leftになった旧世代がいくつあっても新規insertは1回だけ成功する。
 */
export async function findOrCreateActiveGroup(input: {
  orgId: string
  accountId: string
  externalGroupId: string
  displayName: string | null
}): Promise<ChannelGroup> {
  const existing = await findActiveGroup(input.accountId, input.externalGroupId)
  if (existing) return existing

  const { data, error } = await admin()
    .from('channel_groups')
    .insert({
      org_id: input.orgId,
      account_id: input.accountId,
      external_group_id: input.externalGroupId,
      display_name: input.displayName,
      channel: 'line',
    })
    .select(GROUP_COLUMNS)
    .single()

  if (error) {
    // レース: join webhookの並行処理で先に他方がinsertした場合は既存を再取得する
    if (error.code === '23505') {
      const raced = await findActiveGroup(input.accountId, input.externalGroupId)
      if (raced) return raced
    }
    throw new Error(`channel_groups: insert failed: ${error.message}`)
  }
  return toChannelGroup(data as GroupRow)
}

export async function markGroupLeft(accountId: string, externalGroupId: string): Promise<void> {
  await admin()
    .from('channel_groups')
    .update({ status: 'left', left_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('external_group_id', externalGroupId)
    .eq('status', 'active')
}

export async function findGroupById(groupId: string): Promise<ChannelGroup | null> {
  const { data, error } = await admin()
    .from('channel_groups')
    .select(GROUP_COLUMNS)
    .eq('id', groupId)
    .maybeSingle()

  if (error || !data) return null
  return toChannelGroup(data as GroupRow)
}

export async function verifyGroupInOrg(orgId: string, groupId: string): Promise<ChannelGroup | null> {
  const group = await findGroupById(groupId)
  if (!group || group.orgId !== orgId) return null
  return group
}

/**
 * リンクコード成立時のspace紐付け＋バックフィルを単一RPCで原子化する。
 * space_id NULL→値の一方向（DBトリガーでも強制）。既に紐付け済み(space_id非null)なら
 * false を返し、呼び出し側は通常メッセージ扱いにする。
 *
 * 以前はlinkGroupToSpace(update)→backfillGroupSpaceId(2回update)を別々のクエリで
 * 行っており、途中クラッシュで「space_idはセット済みだがbackfill未実行」のまま
 * 永久に固定される穴があった（space_idはNULL→値の一方向のため再試行不可）。
 * rpc_link_group_to_space内で同一トランザクションにして解消する。
 */
export async function linkGroupToSpaceAtomic(groupId: string, spaceId: string): Promise<boolean> {
  const { data, error } = await admin().rpc('rpc_link_group_to_space', {
    p_group_id: groupId,
    p_space_id: spaceId,
  })
  if (error) throw new Error(`rpc_link_group_to_space failed: ${error.message}`)
  return !!data
}

export interface UpdateChannelGroupInput {
  pickupMode?: PickupMode
  displayName?: string
}

/**
 * 'all' への切替時は last_extracted_message_created_at = now() に更新する
 * （mention_only/off 期間中の溜まったバックログを一括LLM投入しないため。切替前の発言は拾わない仕様）。
 */
export async function updateChannelGroup(
  groupId: string,
  updates: UpdateChannelGroupInput,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.pickupMode !== undefined) {
    patch.pickup_mode = updates.pickupMode
    if (updates.pickupMode === 'all') {
      patch.last_extracted_message_created_at = new Date().toISOString()
    }
  }
  if (updates.displayName !== undefined) patch.display_name = updates.displayName
  if (Object.keys(patch).length === 0) return

  await admin().from('channel_groups').update(patch).eq('id', groupId)
}

/**
 * unlink（誤紐付けの是正）。旧世代のopenな申し送りタスクはauto-dismissする
 * （新世代へは引き継がない設計。§2.1参照）。
 */
export async function unlinkGroup(groupId: string): Promise<void> {
  const client = admin()
  await client
    .from('channel_groups')
    .update({ status: 'left', left_at: new Date().toISOString() })
    .eq('id', groupId)
  await client
    .from('channel_digest_tasks')
    .update({ status: 'dismissed' })
    .eq('group_id', groupId)
    .eq('status', 'open')
}

export interface DigestEligibleGroup {
  id: string
  orgId: string
  accountId: string
  externalGroupId: string
  pickupMode: PickupMode
  lastExtractedMessageCreatedAt: string | null
}

/**
 * cronの対象: status='active' かつ pickup_mode<>'off' かつ 紐づくaccountがstatus='active'。
 * pickupModeを返すのはcron側が抽出可否（'all'のみLLM抽出）を判定するため。
 */
export async function findDigestEligibleGroups(): Promise<DigestEligibleGroup[]> {
  const { data, error } = await admin()
    .from('channel_groups')
    .select(
      'id, org_id, account_id, external_group_id, pickup_mode, last_extracted_message_created_at, channel_accounts!inner(status)',
    )
    .eq('status', 'active')
    .neq('pickup_mode', 'off')
    .eq('channel_accounts.status', 'active')

  if (error || !data) return []
  type EligibleRow = {
    id: string
    org_id: string
    account_id: string
    external_group_id: string
    pickup_mode: string
    last_extracted_message_created_at: string | null
  }
  return (data as unknown as EligibleRow[]).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    accountId: row.account_id,
    externalGroupId: row.external_group_id,
    pickupMode: toPickupMode(row.pickup_mode),
    lastExtractedMessageCreatedAt: row.last_extracted_message_created_at,
  }))
}

// ---------------------------------------------------------------------------
// channel_messages
// ---------------------------------------------------------------------------

export interface InsertChannelMessageInput {
  orgId: string
  spaceId: string | null
  identityId: string | null
  accountId: string | null
  /** グループ発言の帰属（不変列）。1:1メッセージは null */
  groupId?: string | null
  channel: string
  direction: 'inbound' | 'outbound'
  actor: 'client' | 'secretary' | 'staff' | 'system'
  externalUserId: string | null
  externalMessageId: string | null
  contentType: string
  body: string | null
  payload: Record<string, unknown>
  storagePath: string | null
  status: 'received' | 'queued' | 'sent' | 'failed'
  error: string | null
  occurredAt: string
  sentBy?: string | null
}

export async function insertChannelMessage(
  input: InsertChannelMessageInput,
): Promise<{ id: string } | 'duplicate'> {
  const { data, error } = await admin()
    .from('channel_messages')
    .insert({
      org_id: input.orgId,
      space_id: input.spaceId,
      identity_id: input.identityId,
      account_id: input.accountId,
      group_id: input.groupId ?? null,
      channel: input.channel,
      direction: input.direction,
      actor: input.actor,
      external_user_id: input.externalUserId,
      external_message_id: input.externalMessageId,
      content_type: input.contentType,
      body: input.body,
      payload: input.payload,
      storage_path: input.storagePath,
      status: input.status,
      error: input.error,
      sent_by: input.sentBy ?? null,
      occurred_at: input.occurredAt,
    })
    .select('id')
    .single()

  if (error) {
    // webhook再送: dedupe unique index 違反は正常系
    if (error.code === '23505') return 'duplicate'
    throw new Error(`channel_messages: insert failed: ${error.message}`)
  }
  return { id: data!.id as string }
}

export async function updateChannelMessageStatus(
  messageId: string,
  status: 'sent' | 'failed',
  errorText?: string,
): Promise<void> {
  await admin()
    .from('channel_messages')
    .update({ status, error: errorText ?? null })
    .eq('id', messageId)
}

// ---------------------------------------------------------------------------
// channel_digest_tasks
// ---------------------------------------------------------------------------

export interface GroupTextMessage {
  id: string
  body: string
  createdAt: string
}

/**
 * 抽出対象: 水位より後・textのみ・actor='client'（secretary/systemの発言は除く）。
 * sinceIso が null なら（初回抽出）そのグループの全text発言が対象。
 */
/**
 * 1回のcronで抽出に渡す上限。初回抽出などでグループの滞留メッセージが極端に多い場合でも
 * 無制限に投入してLLM呼び出しが詰まらないよう、古い順にこの件数だけ処理する。
 * 水位は「このバッチの末尾」まで前進するため、残りは次回cronで続きから処理される。
 */
export const GROUP_TEXT_MESSAGES_BATCH_LIMIT = 500

export async function findGroupTextMessagesSince(
  groupId: string,
  sinceIso: string | null,
): Promise<GroupTextMessage[]> {
  let query = admin()
    .from('channel_messages')
    .select('id, body, created_at')
    .eq('group_id', groupId)
    .eq('content_type', 'text')
    .eq('actor', 'client')
    .order('created_at', { ascending: true })
    .limit(GROUP_TEXT_MESSAGES_BATCH_LIMIT)

  if (sinceIso) {
    query = query.gt('created_at', sinceIso)
  }

  const { data, error } = await query
  if (error || !data) return []
  return (data as Array<{ id: string; body: string | null; created_at: string }>)
    .filter((row): row is { id: string; body: string; created_at: string } => !!row.body)
    .map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at }))
}

export interface DigestTaskCandidate {
  sourceMessageId: string
  title: string
  assigneeHint: string | null
}

/**
 * 抽出タスクの原子INSERT＋水位更新（同一トランザクション。exactly-once）。
 * 戻り値は実際にINSERTされた件数（unique(source_message_id,title)による重複は数えない）。
 */
export async function ingestDigestTasks(
  groupId: string,
  newWatermarkIso: string,
  tasks: DigestTaskCandidate[],
): Promise<number> {
  const { data, error } = await admin().rpc('rpc_ingest_digest_tasks', {
    p_group_id: groupId,
    p_new_watermark: newWatermarkIso,
    p_tasks: tasks.map((t) => ({
      source_message_id: t.sourceMessageId,
      title: t.title,
      assignee_hint: t.assigneeHint,
    })),
  })
  if (error) throw new Error(`rpc_ingest_digest_tasks failed: ${error.message}`)
  return (data as number) ?? 0
}

export interface CreateInstantDigestTaskInput {
  orgId: string
  groupId: string
  /** groupからのデノーマライズ。未紐付けグループ（space_id null）でも作成できる */
  spaceId: string | null
  sourceMessageId: string
  title: string
}

/**
 * メンション即時タスク化（Stage 2.5 §2）: channel_digest_tasks へ直接INSERTする。
 * extracted_dateはJST日付（formatDateToLocalString使用。toISOString().split禁止）。
 * unique(source_message_id, title) 競合（webhook再送等）は握って冪等成功('duplicate')扱いにする。
 */
export async function createInstantDigestTask(
  input: CreateInstantDigestTaskInput,
): Promise<{ id: string; title: string } | 'duplicate'> {
  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .insert({
      org_id: input.orgId,
      group_id: input.groupId,
      space_id: input.spaceId,
      source_message_id: input.sourceMessageId,
      title: input.title,
      extracted_date: formatDateToLocalString(new Date()),
    })
    .select('id, title')
    .single()

  if (error) {
    if (error.code === '23505') return 'duplicate'
    throw new Error(`channel_digest_tasks: insert failed: ${error.message}`)
  }
  return { id: data!.id as string, title: data!.title as string }
}

export interface NumberedDigestTask {
  id: string
  title: string
  digestNumber: number
}

/**
 * 配信直前の再採番: まず当該グループの digest_number を全行NULLクリアしてから、
 * openなタスクにcreated_at順で1..Nを振り直す。
 * （「完了N」返信が常に最新世代のみにマッチし、昨日の一覧が今朝の別タスクを消さないため）
 */
export async function clearAndRenumberOpenDigestTasks(groupId: string): Promise<NumberedDigestTask[]> {
  const client = admin()
  await client.from('channel_digest_tasks').update({ digest_number: null }).eq('group_id', groupId)

  const { data, error } = await client
    .from('channel_digest_tasks')
    .select('id, title, created_at')
    .eq('group_id', groupId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })

  if (error || !data || data.length === 0) return []

  const rows = data as Array<{ id: string; title: string }>
  const numbered = rows.map((row, index) => ({ id: row.id, title: row.title, digestNumber: index + 1 }))

  await Promise.all(
    numbered.map((task) =>
      client.from('channel_digest_tasks').update({ digest_number: task.digestNumber }).eq('id', task.id),
    ),
  )

  return numbered
}

export interface DigestTaskForVerification {
  id: string
  title: string
  status: 'open' | 'done' | 'dismissed'
  groupId: string
  orgId: string
  accountId: string
}

/**
 * postback/console消し込みの検証用: task→group→account の系列を1件で取得する。
 * task.group_id が webhook解決済みaccountのものかは呼び出し側で比較する。
 */
export async function findDigestTaskForVerification(
  taskId: string,
): Promise<DigestTaskForVerification | null> {
  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .select('id, title, status, group_id, org_id, channel_groups!inner(account_id)')
    .eq('id', taskId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as {
    id: string
    title: string
    status: string
    group_id: string
    org_id: string
    channel_groups: { account_id: string } | { account_id: string }[]
  }
  const groupRel = Array.isArray(row.channel_groups) ? row.channel_groups[0] : row.channel_groups
  if (!groupRel) return null
  return {
    id: row.id,
    title: row.title,
    status: row.status as DigestTaskForVerification['status'],
    groupId: row.group_id,
    orgId: row.org_id,
    accountId: groupRel.account_id,
  }
}

/**
 * 原子更新（status='open'の行のみ）。0行なら「既に完了済み」として扱う（二重タップ吸収）。
 */
export async function markDigestTaskDoneAtomic(
  taskId: string,
  doneVia: 'postback' | 'reply' | 'console',
  doneByExternalUserId: string | null,
): Promise<{ id: string; title: string } | null> {
  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .update({
      status: 'done',
      done_at: new Date().toISOString(),
      done_via: doneVia,
      done_by_external_user_id: doneByExternalUserId,
    })
    .eq('id', taskId)
    .eq('status', 'open')
    .select('id, title')
    .maybeSingle()

  if (error || !data) return null
  return { id: data.id as string, title: data.title as string }
}

/**
 * グループ内「完了N」返信の突合。openかつdigest_number=Nの行のみを原子更新する。
 */
export async function markDigestTaskDoneByGroupAndNumberAtomic(
  groupId: string,
  digestNumber: number,
  doneByExternalUserId: string | null,
): Promise<{ id: string; title: string } | null> {
  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .update({
      status: 'done',
      done_at: new Date().toISOString(),
      done_via: 'reply',
      done_by_external_user_id: doneByExternalUserId,
    })
    .eq('group_id', groupId)
    .eq('digest_number', digestNumber)
    .eq('status', 'open')
    .select('id, title')
    .maybeSingle()

  if (error || !data) return null
  return { id: data.id as string, title: data.title as string }
}

const REOPEN_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 完了の取り消し（Stage 2.5 §3-2）。原子更新（status='done'かつdone_atが24時間以内の行のみ）。
 * 0行なら「取り消せない」（既にopen/dismissed、または24時間超過=トーク履歴に残った古いボタンからの
 * ゾンビreopen防止）として null を返す。
 */
export async function reopenDigestTaskAtomic(taskId: string): Promise<{ id: string; title: string } | null> {
  const cutoff = new Date(Date.now() - REOPEN_UNDO_WINDOW_MS).toISOString()
  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .update({ status: 'open', done_at: null, done_via: null, done_by_external_user_id: null })
    .eq('id', taskId)
    .eq('status', 'done')
    .gt('done_at', cutoff)
    .select('id, title')
    .maybeSingle()

  if (error || !data) return null
  return { id: data.id as string, title: data.title as string }
}

export async function findDigestTaskOrgId(taskId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .select('org_id')
    .eq('id', taskId)
    .maybeSingle()
  if (error || !data) return null
  return data.org_id as string
}

/**
 * コンソールからの消し込み/復旧。open復旧はdone_*をクリアする。
 *
 * 同一statusへの更新はno-op（Stage 3 §2-1 付随修正）: neq('status', status)で対象0件に
 * すれば実UPDATEを発行しない。done→doneの再送(楽観的更新のリトライ・二重クリック)で
 * done_at/done_via/done_by_external_user_idが新しい値に上書きされ、元の消し込み証跡が
 * 壊れるのを防ぐ。enqueueトリガー(old.status IS DISTINCT FROM new.status)も元々空遷移では
 * 発火しないため、no-op化してもsink配達への影響はない。
 * update 0件は「既に同じstatus」と「taskId不在」を区別できないため、その場合だけ
 * 存在確認を挟み、二重クリックをAPI層で404エラー扱いにしない(冪等成功として返す)。
 */
export async function updateDigestTaskStatusConsole(
  taskId: string,
  status: 'done' | 'dismissed' | 'open',
): Promise<boolean> {
  const patch: Record<string, unknown> =
    status === 'open'
      ? { status: 'open', done_at: null, done_via: null, done_by_external_user_id: null }
      : { status, done_at: new Date().toISOString(), done_via: 'console', done_by_external_user_id: null }

  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .update(patch)
    .eq('id', taskId)
    .neq('status', status)
    .select('id')
    .maybeSingle()

  if (error) return false
  if (data) return true

  const { data: existing } = await admin()
    .from('channel_digest_tasks')
    .select('id')
    .eq('id', taskId)
    .maybeSingle()
  return !!existing
}

// ---------------------------------------------------------------------------
// Storage（添付）
// ---------------------------------------------------------------------------

const ATTACHMENTS_BUCKET = 'channel-attachments'

export async function uploadAttachment(
  orgId: string,
  externalMessageId: string,
  data: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const path = `${orgId}/line/${externalMessageId}`
  const { error } = await admin()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(path, data, { contentType, upsert: false })

  // 再送で既に保存済みならそのパスを返す
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`channel-attachments: upload failed: ${error.message}`)
  }
  return path
}
