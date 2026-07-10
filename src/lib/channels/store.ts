import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

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
}

interface AccountRow {
  id: string
  org_id: string
  display_name: string
  credentials_encrypted: string
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
  }
}

export async function findLineAccountByDestination(
  destination: string,
): Promise<LineAccount | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id, org_id, display_name, credentials_encrypted')
    .eq('channel', 'line')
    .eq('line_bot_user_id', destination)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) return null
  return decryptAccount(data as AccountRow)
}

export async function findLineAccountForOrg(orgId: string): Promise<LineAccount | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id, org_id, display_name, credentials_encrypted')
    .eq('channel', 'line')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) return null
  return decryptAccount(data as AccountRow)
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
// channel_messages
// ---------------------------------------------------------------------------

export interface InsertChannelMessageInput {
  orgId: string
  spaceId: string | null
  identityId: string | null
  accountId: string | null
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
