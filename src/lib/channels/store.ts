import { randomBytes, randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dueSortKey } from '@/lib/channels/digest/due'
import type { MentionedAssignee } from '@/lib/channels/digest/compute'
import {
  generateSharedGroupClaimCode,
  hashSharedGroupClaimCode,
  formatGroupClaimCodeForDisplay,
  CODE_ONLY_CLAIM_DEFAULT_TTL_MS,
} from '@/lib/channels/sharedGroupClaim'
import { fetchBotInfo } from '@/lib/channels/line/client'
import { resolveOrgEntitlements, planLimits } from '@/lib/billing/entitlements'
import { deriveLineSelfServeState, type LineSelfServeState } from '@/lib/channels/sharedBotAccess'

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

/**
 * 資格情報JSONを暗号化する（sinks/store の encryptSecret と同じ pgcrypto 経路）。
 * 失敗時は必ず throw する — 平文のまま保存 or 半端な状態を残さないため。
 */
async function encryptSystemSecret(plaintext: string): Promise<string> {
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
 * 受信Webhookの secret_token 等、サーバーが生成する機微値。
 * sinks の generateWebhookSecret と同じ形式（whsec_ + 24byte hex）。
 * Telegram の secret_token 仕様（1-256文字・[A-Za-z0-9_-]）を満たす。
 */
export function generateChannelWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`
}

// ---------------------------------------------------------------------------
// channel_accounts
// ---------------------------------------------------------------------------

/**
 * owner_type='org'（顧客専用bot）。org_id は必ず非null。
 * 従来の1顧客=1bot経路。account.orgId をグループ帰属・identity検索の起点に使ってよいのはこの型のみ。
 */
export interface OrgLineAccount {
  ownerType: 'org'
  id: string
  orgId: string
  displayName: string
  channelSecret: string
  accessToken: string
  status: 'active' | 'disabled'
}

/**
 * owner_type='platform'（当社所有の共有bot）。org_id は常にnull — 複数orgで相乗りするため
 * account単体からorgを導出できない（設計正本 §1 帰属導出の絶対規約）。
 * グループ帰属は必ず channel_groups(group.orgId) から取る。1:1/roomはorg解決不能。
 */
export interface PlatformLineAccount {
  ownerType: 'platform'
  id: string
  orgId: null
  displayName: string
  channelSecret: string
  accessToken: string
  status: 'active' | 'disabled'
}

export type LineAccount = OrgLineAccount | PlatformLineAccount

interface AccountRow {
  id: string
  org_id: string | null
  display_name: string
  credentials_encrypted: string
  status: string
  owner_type: string
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

  const status = row.status === 'disabled' ? 'disabled' : 'active'
  if (row.owner_type === 'platform') {
    return {
      ownerType: 'platform',
      id: row.id,
      orgId: null,
      displayName: row.display_name,
      channelSecret: credentials.channel_secret,
      accessToken: credentials.access_token,
      status,
    }
  }
  // owner_type='org'。DB CHECK(channel_accounts_owner_org_consistency)によりorg_idは必ず非null
  if (!row.org_id) {
    console.error('channel_accounts: org account without org_id (schema invariant violated)', row.id)
    return null
  }
  return {
    ownerType: 'org',
    id: row.id,
    orgId: row.org_id,
    displayName: row.display_name,
    channelSecret: credentials.channel_secret,
    accessToken: credentials.access_token,
    status,
  }
}

const ACCOUNT_COLUMNS = 'id, org_id, display_name, credentials_encrypted, status, owner_type'

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
    .select(ACCOUNT_COLUMNS)
    .eq('channel', 'line')
    .eq('line_bot_user_id', destination)
    .maybeSingle()

  if (error || !data) return null
  return decryptAccount(data as AccountRow)
}

export async function findLineAccountById(accountId: string): Promise<LineAccount | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .maybeSingle()

  if (error || !data) return null
  return decryptAccount(data as AccountRow)
}

/**
 * チャネル別の必須資格情報キー（秘書送信境界 sendSecretaryPush 専用の検証）。
 * registry の credentialFields（受信Webhook検証用のキーも含む・例: slack.signing_secret）とは
 * 意図的に別集合にする — ここは「送信アダプタが実際に読むキー」だけに絞る
 * （各 src/lib/channels/adapters/*.ts の ctx.credentials 参照と一致させること）。
 * line だけは既存の LineAccount 契約（decryptAccount）に合わせ channel_secret も必須にする。
 *
 * 各要素は string（そのキーが必須）または string[]（配列内のいずれか1つがあればよい）。
 * discord は2つの送信経路（共有Bot=bot_token / org自前Webhook=webhook_url）に両対応するため
 * "いずれか" にする — 共有Bot(owner_type='platform')はbot_tokenのみ保持しwebhook_urlを
 * 持たない（docs/setup/DISCORD_GATEWAY_PROVISIONING.md L42-48）。
 */
const SECRETARY_PUSH_REQUIRED_CREDENTIALS: Record<string, Array<string | string[]>> = {
  line: ['channel_secret', 'access_token'],
  slack: ['bot_token'],
  telegram: ['bot_token'],
  discord: [['bot_token', 'webhook_url']],
  chatwork: ['api_token'],
  google_chat: ['webhook_url'],
  teams: ['webhook_url'],
  whatsapp: ['access_token', 'phone_number_id'],
}

export type FindAccountForSecretaryPushResult =
  | {
      ok: true
      id: string
      ownerType: 'org' | 'platform'
      channel: string
      credentials: Record<string, string>
      status: 'active' | 'disabled'
    }
  | { ok: false; reason: string }

/**
 * 秘書送信境界(sendSecretaryPush)専用のアカウント解決。findLineAccountByIdと異なり
 * channel条件を付けずidだけで引く（全チャネル対応・digest cron等がline固定でない
 * accountを解決できるようにするため）。
 *
 * 資格情報はチャネル別の必須キーで検証し、欠落時は理由付きで返す（無言の null で消さない）。
 * 旧 decryptAccount は「channel_secret/access_tokenが揃わなければ null」しか返さず、非LINE
 * account を通すと必ず null になり、呼び出し側が「line account not found」と誤表示していた
 * （digest cronの穴・PR1是正）。既存の decryptAccount / findLineAccountById は他の呼び出し元が
 * あるため変更しない。
 */
export async function findAccountForSecretaryPush(
  accountId: string,
): Promise<FindAccountForSecretaryPushResult> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select(`${ACCOUNT_COLUMNS}, channel`)
    .eq('id', accountId)
    .maybeSingle()
  if (error || !data) return { ok: false, reason: 'account_not_found' }

  const row = data as AccountRow & { channel: string }
  const requirements = SECRETARY_PUSH_REQUIRED_CREDENTIALS[row.channel]
  if (!requirements) return { ok: false, reason: 'unsupported_channel' }
  // google_chat の共有Bot(owner_type='platform')はSA(サービスアカウント)認証のみで送る
  // （env GOOGLE_CHAT_SA_KEY・DB資格情報は不要）。webhook_urlを要求すると朝の報告(digest)が
  // missing_credentialで弾かれる穴があった（PR-f）。org所有(webhook_url必須)は現行のまま。
  const effectiveRequirements: Array<string | string[]> =
    row.channel === 'google_chat' && row.owner_type === 'platform' ? [] : requirements

  const { data: decrypted, error: decryptError } = await admin().rpc('decrypt_system_secret', {
    encrypted: row.credentials_encrypted,
    secret: getEncryptionKey(),
  })
  if (decryptError || !decrypted) return { ok: false, reason: 'decrypt_failed' }

  let credentials: Record<string, string>
  try {
    credentials = JSON.parse(decrypted as string)
  } catch {
    return { ok: false, reason: 'credentials_not_json' }
  }

  const missing = effectiveRequirements
    .filter((req) => (Array.isArray(req) ? !req.some((key) => credentials[key]) : !credentials[req]))
    .map((req) => (Array.isArray(req) ? req.join(' or ') : req))
  if (missing.length > 0) {
    return { ok: false, reason: `missing_credentials: ${missing.join(', ')}` }
  }

  return {
    ok: true,
    id: row.id,
    ownerType: row.owner_type === 'platform' ? 'platform' : 'org',
    channel: row.channel,
    credentials,
    status: row.status === 'disabled' ? 'disabled' : 'active',
  }
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
 *
 * owner_type='org'を明示条件に加える（設計正本 §2）: 共有bot(platform)はorgに1:1で
 * 属さないため、org→account逆引きの対象から除く。
 */
export async function findLineAccountForOrg(orgId: string): Promise<LineAccountLookup | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('channel', 'line')
    .eq('org_id', orgId)
    .eq('owner_type', 'org')
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

/**
 * グループ送信用: account_idから直接1クエリで存在確認とstatus判定を済ませる。
 * §3「グループ送信は必ず group.account_id → account」を満たすための解決経路
 * （findLineAccountForOrgのorg→account逆引きをグループ送信に使うことは禁止）。
 * owner_typeでは絞らない — group.account_idは既にorg/platform両方について正しいaccountを指すため。
 */
export async function findLineAccountByIdLookup(accountId: string): Promise<LineAccountLookup | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
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
  /** 'org'=自社LINE（自社の公式アカウント） / 'platform'=共通LINE（TaskApp共通の共有アカウント） */
  ownerType: 'org' | 'platform'
}

const ACCOUNT_META_COLUMNS = 'id, org_id, channel, display_name, line_bot_user_id, status, created_at, owner_type'

interface AccountMetaRow {
  id: string
  org_id: string
  channel: string
  display_name: string
  line_bot_user_id: string | null
  status: string
  created_at: string
  owner_type: string
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
    ownerType: row.owner_type === 'platform' ? 'platform' : 'org',
  }
}

/**
 * この org が「共通LINE（共有bot）」を利用中か。共有botは org_id を持たない（platform account）ため
 * findChannelAccountMetaForOrg（org_id 絞り）には映らない。代わりに、この org に紐付いた active な
 * グループが platform アカウント上に1つでもあれば「共通LINEを利用中」と判定する。
 * これで「共有運用なのにコンソールが未接続に見える」問題を解消する。
 */
export async function orgUsesSharedBot(orgId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('channel_groups')
    .select('id, channel_accounts!inner(owner_type)')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .eq('channel_accounts.owner_type', 'platform')
    .limit(1)
  if (error || !data) return false
  return data.length > 0
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

/**
 * PATCH /api/channels/accounts の課金ゲート用: 対象accountの owner_type を引く。
 * 専用bot(owner_type='org')の再有効化(status→'active')にのみ own_line_account を要求するため、
 * 共有bot(owner_type='platform')の有効化を誤ってゲートしないよう区別する。
 */
export async function findChannelAccountOwnerType(
  accountId: string,
): Promise<'org' | 'platform' | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('owner_type')
    .eq('id', accountId)
    .maybeSingle()

  if (error || !data) return null
  return data.owner_type === 'platform' ? 'platform' : 'org'
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
// 資格情報の登録（非LINEチャットチャネル・owner_type='org'／白ラベル）
//   LINE は line_bot_user_id 逆引き等の専用フローがあるため、この汎用経路には載せない。
//   platform（共有bot）は当社がプロビジョニングするため、この経路では作らせない
//   （owner_type='org' 固定）。認可・Proゲート・入力検証は呼び出し側（API route）の責務。
// ---------------------------------------------------------------------------

export interface RegisterOrgChannelAccountInput {
  orgId: string
  channel: string
  displayName: string
  /** オペレーターが入力した資格情報（registry の credentialFields のキー）。 */
  operatorCredentials: Record<string, string>
  /** サーバーが生成した資格情報（webhook_secret 等）。credentials JSON にマージして保存する。 */
  generatedCredentials?: Record<string, string>
}

export interface RegisterOrgChannelAccountResult {
  account: ChannelAccountMeta
  /** true=新規作成 / false=既存 org account の資格情報を更新（ローテート）。 */
  created: boolean
  /**
   * 実際に保存された生成フィールド（webhook_secret 等）の値。UI表示用に一度だけ返す。
   * ローテート時は既存値を維持する（無言で回転させ受信を壊さないため）ので、
   * 既存に生成値があればそれ、無ければ新規生成値になる。
   */
  generatedSecrets: Record<string, string>
}

/**
 * 同一 org×channel の再利用可能な org account（owner_type='org'）を1件引く。
 * status で絞らない — active優先・同順位は最新（created_at desc）。これにより
 * 「無効化→再接続」でも新規INSERTを増やさず既存行を再利用（再有効化）し、
 * active な org account が同一 org×channel に複数生じるのを防ぐ。
 */
async function findReusableOrgChannelAccountId(orgId: string, channel: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id')
    .eq('org_id', orgId)
    .eq('channel', channel)
    .eq('owner_type', 'org')
    // 'active' < 'disabled'（辞書順）なので ascending で active を先頭にする
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data.id as string
}

/**
 * 既存 org account の資格情報を差し替える（ローテート）。owner_type/org_id は immutable
 * ガード対象なので触らない。生成フィールド（webhook_secret 等）は既存値があれば維持し、
 * 表示名変更や bot_token 打ち直しのたびに受信secretを無言で回転させない。
 */
async function rotateExistingOrgAccount(
  existingId: string,
  input: RegisterOrgChannelAccountInput,
): Promise<RegisterOrgChannelAccountResult> {
  const effectiveGenerated = { ...(input.generatedCredentials ?? {}) }
  const existing = await findChannelAccountCredentials(existingId, input.channel)
  if (existing) {
    for (const key of Object.keys(effectiveGenerated)) {
      // 既存に生成値があれば維持（回転させない）。無ければ今回の新規生成値を使う。
      if (existing.credentials[key]) effectiveGenerated[key] = existing.credentials[key]
    }
  }

  const credentials = { ...input.operatorCredentials, ...effectiveGenerated }
  const credentialsEncrypted = await encryptSystemSecret(JSON.stringify(credentials))

  const { data, error } = await admin()
    .from('channel_accounts')
    .update({
      display_name: input.displayName,
      credentials_encrypted: credentialsEncrypted,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingId)
    .select(ACCOUNT_META_COLUMNS)
    .single()
  if (error || !data) throw new Error(`channel_accounts: update failed: ${error?.message}`)
  return { account: toAccountMeta(data as AccountMetaRow), created: false, generatedSecrets: effectiveGenerated }
}

/**
 * 非LINEチャットチャネルの資格情報を暗号化保存する。
 * 既存の org account があれば資格情報を差し替え（ローテート・created=false）、
 * 無ければ新規作成する（created=true）。owner_type/org_id はサーバー側で固定し、
 * platform を作らせない（設計正本 §2 の帰属導出規約を破らないため）。
 *
 * 並行初回登録の敗者は active 部分一意index（channel_accounts_active_org_channel_unique）で
 * 23505 になり、既存 active を再取得してローテートにフォールバックする
 * （findOrCreateActiveGroup と同型のレース処理）。
 */
export async function registerOrgChannelAccount(
  input: RegisterOrgChannelAccountInput,
): Promise<RegisterOrgChannelAccountResult> {
  const existingId = await findReusableOrgChannelAccountId(input.orgId, input.channel)
  if (existingId) return rotateExistingOrgAccount(existingId, input)

  const generated = { ...(input.generatedCredentials ?? {}) }
  const credentials = { ...input.operatorCredentials, ...generated }
  // 暗号化を先に済ませる（失敗時は throw して行を作らない＝平文/半端行を残さない）。
  const credentialsEncrypted = await encryptSystemSecret(JSON.stringify(credentials))

  const { data, error } = await admin()
    .from('channel_accounts')
    .insert({
      org_id: input.orgId,
      owner_type: 'org',
      channel: input.channel,
      display_name: input.displayName,
      credentials_encrypted: credentialsEncrypted,
      status: 'active',
    })
    .select(ACCOUNT_META_COLUMNS)
    .single()

  if (error) {
    // 並行初回登録の敗者: active一意index違反 → 既存 active を再取得してローテート
    if ((error as { code?: string }).code === '23505') {
      const racedId = await findReusableOrgChannelAccountId(input.orgId, input.channel)
      if (racedId) return rotateExistingOrgAccount(racedId, input)
    }
    throw new Error(`channel_accounts: insert failed: ${error.message}`)
  }
  if (!data) throw new Error('channel_accounts: insert failed: no data')
  return { account: toAccountMeta(data as AccountMetaRow), created: true, generatedSecrets: generated }
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

/**
 * 複数spaceが全て自org内かをまとめて検証する（code_onlyバッチ発行の越境防止用）。
 * 重複排除した件数と、org境界で絞り込んで実際に見つかった件数が一致すればtrue。
 */
export async function verifySpacesInOrg(orgId: string, spaceIds: string[]): Promise<boolean> {
  const unique = [...new Set(spaceIds)]
  if (unique.length === 0) return true

  const { data, error } = await admin().from('spaces').select('id').eq('org_id', orgId).in('id', unique)
  if (error) throw new Error(`spaces: verify batch failed: ${error.message}`)
  return (data?.length ?? 0) === unique.length
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
 *
 * 突合コード（channel_link_codes）はチャネル横断（発行済みの1コードがLINEでもWhatsAppでも通る）。
 * `channel` は「どのチャネルで償還したか」＝作る identity のチャネルを指定する引数で、
 * 既定は 'line'（既存呼び出し元の挙動を変えない）。
 */
export async function linkIdentityViaCode(
  linkCode: ValidLinkCode,
  externalUserId: string,
  channel: string = 'line',
): Promise<ActiveIdentity> {
  const client = admin()
  const { data, error } = await client
    .from('channel_identities')
    .insert({
      org_id: linkCode.orgId,
      space_id: linkCode.spaceId,
      channel,
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
      .eq('channel', channel)
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

/**
 * 'all_plus_instant'（フェーズ2・pro以上限定・有料）: all（毎時LLM抽出）と
 * mention_only（メンション即時タスク化）を同時に行う。ゲート（有料判定）はAPI/webhook層の責務で、
 * store層は値の受け渡しのみ行う（fail-closedの縮退判定はここでは行わない）。
 */
export type PickupMode = 'all' | 'mention_only' | 'off' | 'all_plus_instant'

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
  /** 承認フロー（Stage 2.7-B）の責任者。未設定なら候補を pending にしない（オプトイン） */
  approverUserId: string | null
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
  approver_user_id: string | null
}

function toPickupMode(value: string): PickupMode {
  return value === 'mention_only' || value === 'off' || value === 'all_plus_instant' ? value : 'all'
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
    approverUserId: row.approver_user_id,
  }
}

const GROUP_COLUMNS =
  'id, org_id, space_id, account_id, external_group_id, display_name, status, pickup_mode, last_extracted_message_created_at, approver_user_id'

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
  /** account のチャネル。省略時は後方互換で 'line'。呼び出し側が account.channel を渡す。 */
  channel?: string
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
      channel: input.channel ?? 'line',
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
 * 完了した本体タスク(tasks.id)の「発生元チャットグループ」を解決する。
 *
 * チャット起点タスクは channel_digest_tasks(申し送り)から本体 tasks へ promote される
 * (rpc_promote_digest_task / 20260715074403)。その際 channel_digest_tasks.promoted_task_id に
 * 本体 task の id が刻まれる。よって完了タスクから逆引きするには promoted_task_id で引き、
 * promotion_state='promoted' の行の group_id を返せばよい。
 *
 * 返り値が null になるのは「そのタスクにチャット発生元が無い」場合(gtasks 直接取り込み・
 * コンソール手起票・multica 起点など)。コネクタのチャット返信では null=返信対象なし(delivered:false)
 * として正常に素通りさせる。
 *
 * promote は 1 digest → 1 task で promoted_task_id は実質一意(20260715074403)。万一同一
 * promoted_task_id を指す promoted 行が複数あっても送信先を非決定にしないよう limit(1) で1件に倒す。
 */
export async function findChatOriginGroupForTask(
  taskId: string,
): Promise<{ groupId: string; orgId: string } | null> {
  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .select('group_id, org_id')
    .eq('promoted_task_id', taskId)
    .eq('promotion_state', 'promoted')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`channel_digest_tasks: origin lookup failed: ${error.message}`)
  if (!data) return null
  const row = data as { group_id: string; org_id: string }
  return { groupId: row.group_id, orgId: row.org_id }
}

/**
 * コンソール送信の自動振り分け用: space に紐づく「送信可能な」active グループ接続を1件返す。
 * グループ接続がある相手先はコンソールから（1:1DMではなく）グループ宛てに送る＝Freeでも送れる経路
 * （相手先接続=グループ単位はFreeでも可。1:1個別DMのみが line_direct_dm ゲート対象）。
 * account が disabled のグループは送信不能なので候補から除外する。
 * 複数が同居する場合の選択は selectPreferredActiveGroup に委譲（決定的）。
 */
export async function findActiveGroupForSpace(
  orgId: string,
  spaceId: string,
): Promise<ChannelGroup | null> {
  const { data, error } = await admin()
    .from('channel_groups')
    .select(`${GROUP_COLUMNS}, created_at, channel_accounts!inner(owner_type, status)`)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .eq('status', 'active')
    .eq('channel_accounts.status', 'active')

  if (error || !data) return null

  type JoinedRow = GroupRow & {
    created_at: string
    channel_accounts:
      | { owner_type: string; status: string }
      | { owner_type: string; status: string }[]
      | null
  }
  const candidates = (data as unknown as JoinedRow[]).map((row) => {
    const acc = Array.isArray(row.channel_accounts) ? row.channel_accounts[0] : row.channel_accounts
    return {
      group: toChannelGroup(row),
      ownerType: acc?.owner_type === 'platform' ? ('platform' as const) : ('org' as const),
      createdAt: row.created_at,
    }
  })
  return selectPreferredActiveGroup(candidates)
}

/**
 * 1つのspaceに複数のactiveグループが同居する場合（自社LINE群＋共通LINE群など）の決定的な選択。
 * コンソールは自社アカウント(owner_type='org')の文脈で動くため org を優先し、
 * 同順位は created_at 昇順（最古＝最初の接続）で決める。純関数（テスト用にexport）。
 */
export function selectPreferredActiveGroup(
  candidates: Array<{ group: ChannelGroup; ownerType: 'org' | 'platform'; createdAt: string }>,
): ChannelGroup | null {
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => {
    if (a.ownerType !== b.ownerType) return a.ownerType === 'org' ? -1 : 1
    if (a.createdAt < b.createdAt) return -1
    if (a.createdAt > b.createdAt) return 1
    return 0
  })
  return sorted[0].group
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

export interface OrgGroupWithApprover {
  groupId: string
  displayName: string | null
  spaceId: string
  spaceName: string | null
  approverUserId: string | null
  pickupMode: PickupMode
}

/**
 * 承認フロー設定用に、org の active かつ space 紐付け済みグループを一覧する（Stage 2.7-B §5）。
 * 各グループの現承認者(approver_user_id)を返す。承認候補（space admin/editor）は
 * クライアントが space 単位で解決する（useSpaceMembers）ため、ここでは持たない。
 */
export async function listOrgGroupsWithApprover(orgId: string): Promise<OrgGroupWithApprover[]> {
  const { data, error } = await admin()
    .from('channel_groups')
    .select('id, display_name, space_id, approver_user_id, pickup_mode, spaces(name)')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .not('space_id', 'is', null)
    .order('display_name', { ascending: true })
  if (error) throw new Error(`channel_groups: list failed: ${error.message}`)

  type Row = {
    id: string
    display_name: string | null
    space_id: string
    approver_user_id: string | null
    pickup_mode: string
    spaces: { name: string | null } | { name: string | null }[] | null
  }
  return (data as unknown as Row[]).map((row) => {
    const s = Array.isArray(row.spaces) ? row.spaces[0] : row.spaces
    return {
      groupId: row.id,
      displayName: row.display_name,
      spaceId: row.space_id,
      spaceName: s?.name ?? null,
      approverUserId: row.approver_user_id,
      pickupMode: toPickupMode(row.pickup_mode),
    }
  })
}

/** 対象ユーザーが org の内部メンバー（owner/admin/member）かを確認する。承認者設定の入力検証に使う。 */
export async function isOrgInternalMember(orgId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`org_memberships: select failed: ${error.message}`)
  const role = data?.role as string | undefined
  return role === 'owner' || role === 'admin' || role === 'member'
}

/**
 * 対象ユーザーが space の admin/editor（＝承認権限を持ち得る）かを確認する。
 * これを満たさない人を approver にすると、承認時の _digest_actor_can_approve を永遠に
 * 満たせず候補が宙吊りになるため、設定を弾く。
 */
export async function isSpaceApproverEligible(spaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('space_memberships')
    .select('role')
    .eq('space_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`space_memberships: select failed: ${error.message}`)
  const role = data?.role as string | undefined
  return role === 'admin' || role === 'editor'
}

/**
 * グループの承認者を原子的に設定/解除する（Stage 2.7-B）。approver 変更時に旧責任者宛の
 * 未処理 pending を通常の申し送り(none)へ戻し、宙吊りを防ぐ。RPC(行ロック)で束ねる。
 */
export async function setGroupApprover(
  groupId: string,
  approverUserId: string | null,
): Promise<void> {
  const { error } = await admin().rpc('rpc_set_group_approver', {
    p_group_id: groupId,
    p_new_approver: approverUserId,
  })
  if (error) throw new Error(`rpc_set_group_approver failed: ${error.message}`)
}

/**
 * 'all'/'all_plus_instant'（いずれも毎時LLM抽出を伴う）への切替時は
 * last_extracted_message_created_at = now() に更新する
 * （mention_only/off 期間中の溜まったバックログを一括LLM投入しないため。切替前の発言は拾わない仕様）。
 */
export async function updateChannelGroup(
  groupId: string,
  updates: UpdateChannelGroupInput,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.pickupMode !== undefined) {
    patch.pickup_mode = updates.pickupMode
    if (updates.pickupMode === 'all' || updates.pickupMode === 'all_plus_instant') {
      patch.last_extracted_message_created_at = new Date().toISOString()
    }
  }
  if (updates.displayName !== undefined) patch.display_name = updates.displayName
  if (Object.keys(patch).length === 0) return

  const { error } = await admin().from('channel_groups').update(patch).eq('id', groupId)
  if (error) throw new Error(`channel_groups: update failed: ${error.message}`)
}

export interface ChannelGroupMetadataPatch {
  serviceUrl?: string
  teamId?: string
  tenantId?: string
}

/**
 * channel_groups.metadata（jsonb・teams専用の付帯情報。PR-1で追加した器）へのマージ更新。
 * 既存キーを壊さず patch のキーだけ上書きする（Teams claimed 発言のたびに serviceUrl/teamId/
 * tenantId を反映し、PR-3の能動送信が使えるようにするため）。
 *
 * ⚠ TOCTOU: select→update は同一トランザクションではないため、並行webhookでは後勝ちの
 * 上書きが起こり得る。値は同一グループなら毎回同じ内容が再送されるため実害は無い（許容・
 * group_capacity-hardlimit-decisionと同種のFable許容範囲）。呼び出し側（webhookHandler）で
 * best-effort（失敗は握りつぶし、記録・完了処理を壊さない）として使う想定。
 */
export async function updateChannelGroupMetadata(
  groupId: string,
  patch: ChannelGroupMetadataPatch,
): Promise<void> {
  if (Object.keys(patch).length === 0) return

  const { data: existing, error: selectError } = await admin()
    .from('channel_groups')
    .select('metadata')
    .eq('id', groupId)
    .maybeSingle()
  if (selectError) {
    throw new Error(`channel_groups: metadata select failed: ${selectError.message}`)
  }

  const current = (existing?.metadata as Record<string, unknown> | null) ?? {}
  const merged = { ...current, ...patch }

  const { error } = await admin().from('channel_groups').update({ metadata: merged }).eq('id', groupId)
  if (error) throw new Error(`channel_groups: metadata update failed: ${error.message}`)
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
  /** 未紐付けグループは null。identity解決を顧問先スコープに限るために必要 */
  spaceId: string | null
  accountId: string
  externalGroupId: string
  pickupMode: PickupMode
  lastExtractedMessageCreatedAt: string | null
  /**
   * チャネル固有の付帯情報（現状はteamsのserviceUrl/teamId/tenantIdのみ・PR-1/PR-2）。
   * teams以外のチャネルは常にnull（書き込み経路が無いため）。PR-3: cronがteamsグループへ
   * providerContext.serviceUrlを渡すために追加（既存フィールドの意味・他呼び出し元は変えない）。
   */
  metadata: Record<string, unknown> | null
}

/**
 * cronの対象: status='active' かつ pickup_mode<>'off' かつ 紐づくaccountがstatus='active'。
 * pickupModeを返すのはcron側が抽出可否（'all'のみLLM抽出）を判定するため。
 */
export async function findDigestEligibleGroups(): Promise<DigestEligibleGroup[]> {
  const { data, error } = await admin()
    .from('channel_groups')
    .select(
      'id, org_id, space_id, account_id, external_group_id, pickup_mode, last_extracted_message_created_at, metadata, channel_accounts!inner(status)',
    )
    .eq('status', 'active')
    .neq('pickup_mode', 'off')
    .eq('channel_accounts.status', 'active')

  if (error || !data) return []
  type EligibleRow = {
    id: string
    org_id: string
    space_id: string | null
    account_id: string
    external_group_id: string
    pickup_mode: string
    last_extracted_message_created_at: string | null
    metadata: Record<string, unknown> | null
  }
  return (data as unknown as EligibleRow[]).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    spaceId: row.space_id,
    accountId: row.account_id,
    externalGroupId: row.external_group_id,
    pickupMode: toPickupMode(row.pickup_mode),
    lastExtractedMessageCreatedAt: row.last_extracted_message_created_at,
    metadata: row.metadata ?? null,
  }))
}

// ---------------------------------------------------------------------------
// 共有bot（platform account）のグループ紐付けコード（Stage 4 §1/§2/§3）
//
// 紐付け先org/spaceは常に channel_link_codes（code）自身が単一の真実源（設計正本 §3/§7-8）。
// webhookはこのコードを償還してclaimを作るところまでを担い、group行の作成は
// service-role専用の承認RPCファミリ（rpc_approve_group_claim等）だけが行う
// （webhook内アドホックINSERT禁止）。
// ---------------------------------------------------------------------------

export interface SharedGroupClaimLinkCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

/**
 * shared_group_claim コードの償還用検証（webhook受信側）。
 * purpose='shared_group_claim'・対象account(target_account_id)に一致・未消費・未失効・
 * 未revokeのもののみ返す。理由の別（not found/expired/consumed/wrong account）は
 * 呼び出し側に一切渡さない（設計正本 §3: コード不正時の応答を統一。存在/期限/orgを推測させない）。
 */
export async function findValidSharedGroupClaimCode(
  codeHash: string,
  targetAccountId: string,
): Promise<SharedGroupClaimLinkCode | null> {
  const { data, error } = await admin()
    .from('channel_link_codes')
    .select('id, org_id, space_id, binding_mode, target_account_id, consumed_at, revoked_at, expires_at')
    .eq('code_hash', codeHash)
    .eq('purpose', 'shared_group_claim')
    .maybeSingle()

  if (error || !data) return null
  const row = data as {
    id: string
    org_id: string | null
    space_id: string | null
    binding_mode: string | null
    target_account_id: string | null
    consumed_at: string | null
    revoked_at: string | null
    expires_at: string
  }
  if (row.target_account_id !== targetAccountId) return null
  if (row.consumed_at) return null
  if (row.revoked_at) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  if (!row.org_id || !row.space_id || !row.binding_mode) return null

  return {
    id: row.id,
    orgId: row.org_id,
    spaceId: row.space_id,
    bindingMode: row.binding_mode === 'code_only' ? 'code_only' : 'web_approval',
  }
}

export interface GroupClaim {
  id: string
  orgId: string
  spaceId: string
  challengeLabel: string | null
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved'
}

interface GroupClaimRow {
  id: string
  org_id: string
  space_id: string
  challenge_label: string | null
  status: string
}

function toGroupClaim(row: GroupClaimRow): GroupClaim {
  return {
    id: row.id,
    orgId: row.org_id,
    spaceId: row.space_id,
    challengeLabel: row.challenge_label,
    status: row.status as GroupClaim['status'],
  }
}

const GROUP_CLAIM_COLUMNS = 'id, org_id, space_id, challenge_label, status'

async function findPendingGroupClaim(
  linkCodeId: string,
  accountId: string,
  externalGroupId: string,
): Promise<GroupClaim | null> {
  const { data, error } = await admin()
    .from('channel_group_claims')
    .select(GROUP_CLAIM_COLUMNS)
    .eq('link_code_id', linkCodeId)
    .eq('account_id', accountId)
    .eq('external_group_id', externalGroupId)
    .eq('status', 'pending')
    .maybeSingle()

  if (error || !data) return null
  return toGroupClaim(data as GroupClaimRow)
}

export interface CreateGroupClaimInput {
  linkCodeId: string
  accountId: string
  externalGroupId: string
  orgId: string
  spaceId: string
  challengeLabel: string
  groupDisplayNameSnapshot: string | null
}

/**
 * web_approval紐付けコード投入の受け口（PR2）。webhook再送(dedupe)では新規INSERTを試みず
 * 既存の pending claim をそのまま返す（findOrCreateActiveGroupと同型: 先に既存を見て、
 * 無ければinsertしレースは23505(channel_group_claims_pending_unique)で再取得する）。
 */
export async function findOrCreatePendingGroupClaim(input: CreateGroupClaimInput): Promise<GroupClaim> {
  const existing = await findPendingGroupClaim(input.linkCodeId, input.accountId, input.externalGroupId)
  if (existing) return existing

  const { data, error } = await admin()
    .from('channel_group_claims')
    .insert({
      link_code_id: input.linkCodeId,
      account_id: input.accountId,
      external_group_id: input.externalGroupId,
      org_id: input.orgId,
      space_id: input.spaceId,
      challenge_label: input.challengeLabel,
      group_display_name_snapshot: input.groupDisplayNameSnapshot,
    })
    .select(GROUP_CLAIM_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      const raced = await findPendingGroupClaim(input.linkCodeId, input.accountId, input.externalGroupId)
      if (raced) return raced
    }
    throw new Error(`channel_group_claims: insert failed: ${error.message}`)
  }
  return toGroupClaim(data as GroupClaimRow)
}

// ---------------------------------------------------------------------------
// 共有botグループ紐付け（web_approval）の承認コンソール（Stage 4 §3・PR3a）
//
// promoteの digest 承認（rpc_promote_digest_task 系）とは別概念・別命名。
// こちらは channel_group_claims / rpc_approve_group_claim / rpc_reject_group_claim を扱う。
// ---------------------------------------------------------------------------

export interface PendingGroupClaim {
  id: string
  externalGroupId: string
  spaceId: string
  spaceName: string | null
  challengeLabel: string | null
  groupDisplayNameSnapshot: string | null
  createdAt: string
}

const GROUP_CLAIM_PENDING_COLUMNS =
  'id, external_group_id, space_id, challenge_label, group_display_name_snapshot, created_at, spaces(name)'

/** 承認コンソール「確認待ち」一覧。自orgのpending claimをspace表示名付きで古い順に返す */
export async function listPendingGroupClaimsForOrg(orgId: string): Promise<PendingGroupClaim[]> {
  const { data, error } = await admin()
    .from('channel_group_claims')
    .select(GROUP_CLAIM_PENDING_COLUMNS)
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`channel_group_claims: list failed: ${error.message}`)

  type Row = {
    id: string
    external_group_id: string
    space_id: string
    challenge_label: string | null
    group_display_name_snapshot: string | null
    created_at: string
    spaces: { name: string | null } | { name: string | null }[] | null
  }
  return ((data as unknown as Row[]) ?? []).map((row) => {
    const s = Array.isArray(row.spaces) ? row.spaces[0] : row.spaces
    return {
      id: row.id,
      externalGroupId: row.external_group_id,
      spaceId: row.space_id,
      spaceName: s?.name ?? null,
      challengeLabel: row.challenge_label,
      groupDisplayNameSnapshot: row.group_display_name_snapshot,
      createdAt: row.created_at,
    }
  })
}

/** 承認/却下APIの認可用: claimの実所属orgを引く（クライアント申告のorgIdは信用しない） */
export async function findGroupClaimOrgId(claimId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('channel_group_claims')
    .select('org_id')
    .eq('id', claimId)
    .maybeSingle()
  if (error || !data) return null
  return data.org_id as string
}

/**
 * 承認APIの認可＋容量分岐用: claimの実所属orgと、そのclaimが属するチャネル
 * （claim.account_id → channel_accounts.channel）を1クエリで引く。
 * チャネルは容量/エンタイトルメント判定を LINE と外部チャットで分けるために必要
 * （'line' → maxLineGroups / それ以外 → external_chat_channels + maxExternalChatGroups）。
 */
export async function findGroupClaimOrgAndChannel(
  claimId: string,
): Promise<{ orgId: string; channel: string } | null> {
  const { data, error } = await admin()
    .from('channel_group_claims')
    .select('org_id, channel_accounts!inner(channel)')
    .eq('id', claimId)
    .maybeSingle()
  if (error || !data) return null
  const acc = (data as { channel_accounts: { channel: string } | { channel: string }[] })
    .channel_accounts
  const channel = Array.isArray(acc) ? acc[0]?.channel : acc?.channel
  if (!channel) return null
  return { orgId: (data as { org_id: string }).org_id, channel }
}

export type GroupClaimActionErrorReason =
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'invalid'
  | 'limit'

/**
 * rpc_approve_group_claim / rpc_reject_group_claim は検証失敗を例外(raise exception)で返す
 * 設計（PR1・変更不可）。ここでpostgresの例外を route が HTTP status へ薄くマップできる reason に
 * 分類し直す（route側は薄いままにするための分類ロジックの置き場）。
 */
export class GroupClaimActionError extends Error {
  constructor(
    message: string,
    public readonly reason: GroupClaimActionErrorReason,
  ) {
    super(message)
    this.name = 'GroupClaimActionError'
  }
}

/**
 * L3(errcode標準化・PR3b): 分類はSQLSTATE(error.code)ベース。supabase-jsはPostgREST経由で
 * DBのraise時の`using errcode=`をそのままerror.codeへsurfaceするため、文言変更に脆い
 * message部分一致より堅牢（対応表は claim RPCファミリのmigrationコメントを正本とする）。
 */
function classifyGroupClaimRpcError(code: string | undefined): GroupClaimActionErrorReason {
  switch (code) {
    case 'GC404':
      return 'not_found'
    case 'GC403':
      return 'forbidden'
    case 'GC422':
      return 'invalid'
    case 'GC402':
      // 容量上限のアトミック強制（レース時のみ発火・ソフトチェックは事前に402を返す）
      return 'limit'
    case 'GC409':
      return 'conflict'
    default:
      // 未分類のSQLSTATE（P0001等の構造ガード由来を含む）は安全側で conflict にフォールバックする
      return 'conflict'
  }
}

/**
 * org の「相手先グループ接続」の容量。active グループ数と、プランの上限(maxLineGroups)を返す。
 * maxGroups=null は無制限。プラン解決は org_billing 起点（resolveOrgEntitlements）。
 * これを使って「新規紐付けの拒否」を判定する（既存グループは絶対に切らない＝上限超過でも既存は生存）。
 */
export async function orgLineGroupCapacity(
  orgId: string,
): Promise<{ activeCount: number; maxGroups: number | null }> {
  const { count } = await admin()
    .from('channel_groups')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    // ★channel=line に限定して数える。Discord等の外部チャットグループが LINE 枠を汚染しない
    //   （逆も orgExternalChatGroupCapacity が channel で絞る）。両枠は独立カウント。
    .eq('channel', 'line')
    .eq('status', 'active')
  const ent = await resolveOrgEntitlements(admin(), orgId, new Date())
  return { activeCount: count ?? 0, maxGroups: planLimits(ent.planId).maxLineGroups }
}

/**
 * org が「外部チャット（LINE以外）連携」エンタイトルメント(external_chat_channels)を持つか。
 * Discord等の新規紐付け確立の Pro ゲート（承認/償還の境界でのみ効かせる）。
 */
export async function orgHasExternalChatChannels(orgId: string): Promise<boolean> {
  const ent = await resolveOrgEntitlements(admin(), orgId, new Date())
  return ent.has('external_chat_channels')
}

/**
 * org の「外部チャット（LINE以外・Discord等の共有Bot受信）」の紐付け容量。
 * active な当該channelグループ数と、プランの上限(maxExternalChatGroups)を返す。
 * maxLineGroups とは別カウント（Proの売りとしての外部チャット枠）。v1は channel='discord'。
 */
export async function orgExternalChatGroupCapacity(
  orgId: string,
  channel: string = 'discord',
): Promise<{ activeCount: number; max: number | null }> {
  const { count } = await admin()
    .from('channel_groups')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('channel', channel)
    .eq('status', 'active')
  const ent = await resolveOrgEntitlements(admin(), orgId, new Date())
  return { activeCount: count ?? 0, max: planLimits(ent.planId).maxExternalChatGroups }
}

/**
 * Web承認。approverUserId はAPI routeがセッションから解決した内部ユーザー（クライアント申告禁止）。
 * 戻り値は成功(true)/同時承認の敗者(false・channel_groups_active_uniqueによるgraceful reject)を
 * そのまま返す。それ以外の検証失敗はRPCの例外を GroupClaimActionError として投げ直す。
 */
export async function approveGroupClaim(
  claimId: string,
  approverUserId: string,
  // 容量上限（active化のハード適用点でRPCが同一Tx内アトミックに強制）。null=無制限=現行挙動。
  // 呼び出し側(route)が対象channelに応じ maxLineGroups / maxExternalChatGroups を渡す。
  maxActiveGroups: number | null = null,
): Promise<boolean> {
  const { data, error } = await admin().rpc('rpc_approve_group_claim', {
    p_claim_id: claimId,
    p_approver_user_id: approverUserId,
    p_max_active_groups: maxActiveGroups,
  })
  if (error) throw new GroupClaimActionError(error.message, classifyGroupClaimRpcError(error.code))
  return data === true
}

/** 却下。approveと同型（承認RPCの規律・設計正本 §3）。link_codeは消費しない */
export async function rejectGroupClaim(claimId: string, approverUserId: string): Promise<boolean> {
  const { data, error } = await admin().rpc('rpc_reject_group_claim', {
    p_claim_id: claimId,
    p_approver_user_id: approverUserId,
  })
  if (error) throw new GroupClaimActionError(error.message, classifyGroupClaimRpcError(error.code))
  return data === true
}

/**
 * 複数の active platform account が存在する場合に投げる（L2ガード・設計正本 §10）。
 * フルの複数account選択UIは投機的なので作らない — 実際に複数botが要る運用になった時に
 * 明示的にエラーとして顕在化させ、沈黙のdead-end（誤ったaccountへ黙って発行する事故）を防ぐ。
 */
export class MultiplePlatformAccountsError extends Error {
  constructor() {
    super('multiple active platform accounts exist; explicit selection is required (not yet supported)')
    this.name = 'MultiplePlatformAccountsError'
  }
}

/**
 * コード発行対象の共有bot（platform account）を引く。0件はnull（呼び出し側は「共有botが未設定」
 * として400を返す）。1件ならそのid。2件以上は MultiplePlatformAccountsError を投げる
 * （L2ガード。呼び出し側は409として顧客に見せる）。
 * 2件以上の存在を判定できれば十分なので limit(2) に絞り、全件走査しない。
 *
 * ⚠ channel でスコープする（既定 'line'）。複数チャネルの共有bot（例: LINE共有bot と
 *   Discord共有bot）が併存すると owner_type だけでは複数 active になり L2ガードが誤発火する。
 *   LINEのコード発行は 'line'、Discord受信の解決は 'discord' を渡す。channel×owner_type=platform
 *   の active は各1件が不変条件（多拠点でも1共有bot）。
 */
export async function findFirstPlatformAccountId(
  channel: string = 'line',
): Promise<string | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id')
    .eq('owner_type', 'platform')
    .eq('channel', channel)
    // disabled な共有bot に発行すると償還不能な「死にコード」を配ることになるため active に限定
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(2)
  if (error) throw new Error(`channel_accounts: platform lookup failed: ${error.message}`)
  const rows = (data as { id: string }[] | null) ?? []
  if (rows.length === 0) return null
  if (rows.length >= 2) throw new MultiplePlatformAccountsError()
  return rows[0].id
}

export interface CreateSharedGroupClaimCodeInput {
  orgId: string
  spaceId: string
  targetAccountId: string
  /** hashSharedGroupClaimCode(正準形26文字) の結果。平文コードはここに渡さない */
  codeHash: string
  createdBy: string
  /** timestamptzの瞬時値（toISOStringで可。DATEではないためJSTずれの対象外） */
  expiresAt: string
}

/** code_hashの衝突（unique違反）のとき投げる。呼び出し側はこれに限りリトライしてよい */
export class DuplicateSharedGroupClaimCodeError extends Error {
  constructor() {
    super('shared group claim code collision')
    this.name = 'DuplicateSharedGroupClaimCodeError'
  }
}

/**
 * web_approval コードの発行。生codeは保存しない（code=null・code_hashのみ）。
 * purpose/binding_mode/target_account_id は発行時に焼き込み・以後不変（DB guard trigger）。
 */
export async function createSharedGroupClaimCode(
  input: CreateSharedGroupClaimCodeInput,
): Promise<{ id: string; expiresAt: string }> {
  const { data, error } = await admin()
    .from('channel_link_codes')
    .insert({
      org_id: input.orgId,
      space_id: input.spaceId,
      channel: 'line',
      purpose: 'shared_group_claim',
      binding_mode: 'web_approval',
      target_account_id: input.targetAccountId,
      code_hash: input.codeHash,
      code: null,
      expires_at: input.expiresAt,
      created_by: input.createdBy,
    })
    .select('id, expires_at')
    .single()

  if (error) {
    if (error.code === '23505') throw new DuplicateSharedGroupClaimCodeError()
    throw new Error(`channel_link_codes: shared_group_claim insert failed: ${error.message}`)
  }
  return { id: data!.id as string, expiresAt: data!.expires_at as string }
}

// ---------------------------------------------------------------------------
// 共有bot code_only 紐付け（Stage 4 §1/§3/§4/§7-8・PR3b）
//
// web_approval（人の承認）とは別経路: webhookが rpc_redeem_code_only_claim を1回呼ぶだけで
// 人の承認なしに即時紐付けが成立する。境界はDB制約とA-1トリガーが守る（RPCの正しさに依存しない）。
// ---------------------------------------------------------------------------

export type RedeemCodeOnlyClaimResult = 'linked' | 'already_linked' | 'rejected'

/**
 * rpc_redeem_code_only_claim の薄いラッパ（webhook専用）。
 *
 * GC404（code_hashがどのコードにも一致しない＝記録対象が無い）は 'rejected' に畳んで返す。
 * rpc自体はマッチした無効コード（expired/consumed/revoked/wrong-account/wrong-binding_mode）を
 * 'rejected'（rejected claim記録済み）として返す設計だが、webhook側の応答は「見つからない」も
 * 「マッチしたが無効」も同一の固定文言に畳む必要がある（設計正本 §3: 存在/期限/orgを推測させない）
 * ため、ここで両者を同じ文字列 'rejected' に正規化しておき、呼び出し側の分岐を1本にする。
 *
 * 呼び出し契約（RPCコメント）: 1メッセージイベントにつき1回だけ呼ぶ（webhookのevent-dedupの背後）。
 */
export async function redeemCodeOnlyClaim(
  codeHash: string,
  accountId: string,
  externalGroupId: string,
  groupDisplayName: string | null,
  // 容量上限（RPCが同一Tx内アトミックに強制）。null=無制限=現行挙動。
  maxActiveGroups: number | null = null,
): Promise<RedeemCodeOnlyClaimResult> {
  const { data, error } = await admin().rpc('rpc_redeem_code_only_claim', {
    p_code_hash: codeHash,
    p_account_id: accountId,
    p_external_group_id: externalGroupId,
    p_group_display_name: groupDisplayName,
    p_max_active_groups: maxActiveGroups,
  })
  if (error) {
    if (error.code === 'GC404') return 'rejected'
    // 容量上限のレース（GC402）は「今は確立させない」＝無効文言に畳む（ソフトチェックと同じ結末）。
    if (error.code === 'GC402') return 'rejected'
    throw new Error(`rpc_redeem_code_only_claim failed: ${error.message}`)
  }
  if (data === 'linked' || data === 'already_linked' || data === 'rejected') return data
  throw new Error(`rpc_redeem_code_only_claim: unexpected result ${String(data)}`)
}

/**
 * org単位の code_only entitlement（設計正本 §3: entitlement=false org での発行は拒否）。
 * 明示行の無いorgは既定false（当社が信頼確認したorgにのみ true を付与する運用のため）。
 */
export async function isCodeOnlyEntitled(orgId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('org_channel_policy')
    .select('allow_code_only')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw new Error(`org_channel_policy: select failed: ${error.message}`)
  return (data as { allow_code_only: boolean } | null)?.allow_code_only === true
}

/**
 * org単位の未消費(consumed_at is null)・未失効(expires_at>now)・未revoke(revoked_at is null)な
 * code_only コード数。発行APIの発行レート上限判定に使う（設計正本 §3 code_only の追加不変条件）。
 */
export async function countOutstandingCodeOnlyCodes(orgId: string): Promise<number> {
  const { count, error } = await admin()
    .from('channel_link_codes')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('purpose', 'shared_group_claim')
    .eq('binding_mode', 'code_only')
    .is('consumed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
  if (error) throw new Error(`channel_link_codes: count outstanding code_only failed: ${error.message}`)
  return count ?? 0
}

export interface CreateCodeOnlyClaimCodesBatchInput {
  orgId: string
  spaceIds: string[]
  targetAccountId: string
  createdBy: string
}

export interface CodeOnlyIssuedCode {
  spaceId: string
  displayCode: string
}

/**
 * code_only コードの一括発行（本部/多拠点の一括登録・設計正本 §0/§2）。各spaceに対し
 * CSPRNGで正準形26文字を生成→code_hashのみ保存（生codeはこの関数のスコープ内でのみ扱い、
 * 呼び出し側へは表示形式のみ返す＝§7-5「生codeは保存しない」を満たす）。
 * 同一バッチはbatch_idで束ね、TTLはCODE_ONLY_CLAIM_DEFAULT_TTL_MS（既定7日）で揃える。
 *
 * ★all-or-nothing（敵対レビュー指摘の必須修正）: N行を単一の `insert([...])` 文で投入する。
 * spaceごとに別autocommit insertを繰り返すと、途中（例50件中40件目）で非23505エラーが起きた際に
 * 1〜39件目が**コミット済みのまま**関数がthrowし、(a) 平文コードが呼び出し側へ返らず失われ
 * （DBにはcode_hashのみ残る）、(b) それらが未消費のまま7日間 countOutstandingCodeOnlyCodes の
 * 上限を食い、(c) 本部のリトライが発行レート上限で429ロックアウトする、という不整合を生む。
 * 単一INSERT文はPostgres側で1トランザクションとして扱われるため、部分コミットは起きない
 * （失敗時はDBに1行も残らない＝orphanなし）。
 *
 * code_hash衝突(23505・128bitで非現実的)はバッチ全体を再生成し、同じく単一INSERT文で
 * 最大3回までリトライする（部分成功を許さない設計を維持するため、個別space単位のリトライはしない）。
 * entitlement(allow_code_only)検査・発行レート上限の判定は呼び出し側(API route)の責務。
 */
export async function createCodeOnlyClaimCodesBatch(
  input: CreateCodeOnlyClaimCodesBatchInput,
): Promise<CodeOnlyIssuedCode[]> {
  if (input.spaceIds.length === 0) return []

  const client = admin()
  const batchId = randomUUID()
  const expiresAt = new Date(Date.now() + CODE_ONLY_CLAIM_DEFAULT_TTL_MS).toISOString()

  for (let attempt = 0; attempt < 3; attempt++) {
    const canonicalCodes = input.spaceIds.map(() => generateSharedGroupClaimCode())
    const rows = input.spaceIds.map((spaceId, i) => ({
      org_id: input.orgId,
      space_id: spaceId,
      channel: 'line',
      purpose: 'shared_group_claim',
      binding_mode: 'code_only',
      target_account_id: input.targetAccountId,
      code_hash: hashSharedGroupClaimCode(canonicalCodes[i]),
      code: null,
      expires_at: expiresAt,
      created_by: input.createdBy,
      batch_id: batchId,
    }))

    const { error } = await client.from('channel_link_codes').insert(rows)
    if (!error) {
      return input.spaceIds.map((spaceId, i) => ({
        spaceId,
        displayCode: formatGroupClaimCodeForDisplay(canonicalCodes[i]),
      }))
    }
    if (error.code !== '23505') {
      throw new Error(`channel_link_codes: code_only batch insert failed: ${error.message}`)
    }
    // 23505: このバッチ全体（全行）を再生成して単一INSERTでリトライする（次のループへ）
  }

  throw new Error('channel_link_codes: code_only batch insert failed after retries (code_hash collision)')
}

// ---------------------------------------------------------------------------
// org_channel_policy（メータリング読取・PR4）
// ---------------------------------------------------------------------------

export interface OrgChannelPolicyState {
  state: 'ok' | 'soft' | 'hard'
  onExceed: 'none' | 'degrade' | 'block'
}

/**
 * 送信境界（auto-push: digest/approval-notify等）が読む org 単位の縮退状態。
 * 明示行の無い org は「暗黙 ok/none」（org_channel_policy migration検証コメント §1と同じ規約。
 * 当社が明示的にクォータ/縮退を設定した org のみ state/on_exceed が意味を持つ）。
 */
export async function getOrgChannelPolicyState(orgId: string): Promise<OrgChannelPolicyState> {
  const { data, error } = await admin()
    .from('org_channel_policy')
    .select('state, on_exceed')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw new Error(`org_channel_policy: select failed: ${error.message}`)
  if (!data) return { state: 'ok', onExceed: 'none' }

  const row = data as { state: string; on_exceed: string }
  return {
    state: row.state === 'soft' || row.state === 'hard' ? row.state : 'ok',
    onExceed: row.on_exceed === 'degrade' || row.on_exceed === 'block' ? row.on_exceed : 'none',
  }
}

// ---------------------------------------------------------------------------
// platform_channel_budget（共有bot共通LINEのグローバル予算層読取・fable確定設計）
// ---------------------------------------------------------------------------

export type PlatformBudgetState = 'ok' | 'soft' | 'hard'

/**
 * 送信境界（decideSharedSendBudget のglobal層）が読む account 単位の縮退状態。
 * owner_type='platform'（共有bot）のaccountにのみ意味を持つ。owner_type='org'（専用bot）は
 * 呼出側がそもそも本関数を呼ばない（常に 'ok' 扱い＝顧客側の枠であり当社の持ち出しではない）。
 *
 * getOrgChannelPolicyState（org層）とはfail方向が異なる:
 *   - 行の無い account（cronの自動プロビジョニングが未到達）は暗黙 'ok'。
 *   - DBエラーは例外を投げず fail-closed で 'hard' を返す。グローバル予算は当社が守るべき
 *     LINEアカウントの実物理上限であり、読めない時は緩めるより止める側に倒す。
 */
export async function getPlatformBudgetState(accountId: string): Promise<PlatformBudgetState> {
  const { data, error } = await admin()
    .from('platform_channel_budget')
    .select('state')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('platform_channel_budget: select failed (fail-closed to hard)', accountId, error)
    return 'hard'
  }
  if (!data) return 'ok'

  const row = data as { state: string }
  return row.state === 'soft' || row.state === 'hard' ? row.state : 'ok'
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
  /**
   * 請求対象push（LINE無料枠を消費するpush配信）なら true。既定 false。
   * push（pushLineMessage）配信の記録のみ true にする — reply（replyLineMessage）配信・
   * inbound記録は無料枠を消費しないため false のまま（設計正本 §3・PR4メータリング）。
   */
  billablePush?: boolean
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
      billable_push: input.billablePush ?? false,
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

/**
 * 非LINEチャネルの二重送信防止用（sendSecretaryPush）。LINEはX-Line-Retry-Key(LINE側dedupe)
 * があるため呼ばない。非LINEはサーバ側idempotencyが無いため、送信前に同一(account, retryKey)
 * のoutbound記録が既にあれば送信をスキップする。
 * ⚠ TOCTOU: この確認とinsertChannelMessageは別トランザクションのため、並行実行では
 * すり抜けて二重送信し得る。被害は「報告の二重送信」に留まり課金二重計上ではない
 * （channel_messages_dedupe unique indexが二重"記録"は防ぐ）ため許容する（Fable裁定）。
 */
export async function findOutboundMessageByExternalId(
  accountId: string,
  externalMessageId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await admin()
    .from('channel_messages')
    .select('id')
    .eq('account_id', accountId)
    .eq('external_message_id', externalMessageId)
    .eq('direction', 'outbound')
    .maybeSingle()
  if (error || !data) return null
  return { id: data.id as string }
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
  /**
   * 受信時に正規化したメンション（Stage 2.6 §3）。
   * 夜間一括抽出は生のwebhookイベントを見られないため、
   * 「誰宛の依頼だったか」を復元できるのはここに残した payload.mentionees だけ。
   */
  mentions: MentionedAssignee[]
}

/** payload.mentionees（非信頼なJSON）から担当メンションを取り出す。壊れた要素は捨てる */
function readMentionsFromPayload(payload: unknown): MentionedAssignee[] {
  if (!payload || typeof payload !== 'object') return []
  const raw = (payload as Record<string, unknown>).mentionees
  if (!Array.isArray(raw)) return []

  const mentions: MentionedAssignee[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.displayName !== 'string' || !record.displayName.trim()) continue
    mentions.push({
      userId: typeof record.userId === 'string' ? record.userId : null,
      displayName: record.displayName,
    })
  }
  return mentions
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
    .select('id, body, created_at, payload')
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
  return (data as Array<{ id: string; body: string | null; created_at: string; payload: unknown }>)
    .filter((row): row is { id: string; body: string; created_at: string; payload: unknown } => !!row.body)
    .map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      mentions: readMentionsFromPayload(row.payload),
    }))
}

/**
 * all_plus_instant の重複排除（フェーズ2）: 指定した source_message_id のうち、
 * 既に channel_digest_tasks に存在する（＝メンション即時タスク化済みの）ものを返す。
 * unique制約は (source_message_id, title) だが、即時タイトルとLLM抽出タイトルは通常一致しないため
 * unique制約だけでは重複を防げない。抽出候補を作る前にメッセージ側で除外する必要がある。
 */
export async function findExistingDigestTaskSourceMessageIds(
  groupId: string,
  messageIds: string[],
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set()

  const { data, error } = await admin()
    .from('channel_digest_tasks')
    .select('source_message_id')
    .eq('group_id', groupId)
    .in('source_message_id', messageIds)

  if (error) throw new Error(`channel_digest_tasks: select existing source ids failed: ${error.message}`)
  return new Set((data as Array<{ source_message_id: string }>).map((row) => row.source_message_id))
}

export interface DigestTaskCandidate {
  sourceMessageId: string
  title: string
  /** 担当者名の自由文字列（ラベル）。メンション表示名 or LLM抽出 */
  assigneeHint: string | null
  /** メンションで取れたLINE userId。identity未作成でも残す（後日バックフィルするため） */
  assigneeExternalUserId: string | null
  /** userId が既存identityに解決できた場合のみ */
  assigneeIdentityId: string | null
  dueDate: string | null
  dueTime: string | null
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
      assignee_external_user_id: t.assigneeExternalUserId,
      assignee_identity_id: t.assigneeIdentityId,
      due_date: t.dueDate,
      due_time: t.dueTime,
    })),
  })
  if (error) throw new Error(`rpc_ingest_digest_tasks failed: ${error.message}`)
  return (data as number) ?? 0
}

export interface CreateInstantDigestTaskInput {
  groupId: string
  sourceMessageId: string
  title: string
  assigneeHint?: string | null
  assigneeExternalUserId?: string | null
  assigneeIdentityId?: string | null
  dueDate?: string | null
  dueTime?: string | null
}

export interface CreateInstantDigestTaskResult {
  /** 新規作成時のみ非null。重複(webhook再送)・グループ不在では null */
  id: string | null
  /** 承認フローに乗るか（DB側で「現在の」approver＋space紐付けから確定した値） */
  pending: boolean
  /** unique(source_message_id, title) 競合で既存行に当たった（冪等成功） */
  duplicate: boolean
}

/**
 * メンション即時タスク化（Stage 2.5 §2 / 2.7-B §4-5）: グループ行を FOR UPDATE でロックする
 * RPC(rpc_create_instant_digest_task)経由で INSERT する。承認者(approver_user_id)・space_id は
 * *アプリのスナップショットを信じず* ロックした行から DB 側で読み、pending 判定と promotion 列を確定する。
 *
 * これにより、取得〜INSERT の隙間に rpc_set_group_approver で承認者が変わっても、
 * 旧承認者宛の宙吊り pending が生まれない（承認者変更と直列化される）。
 * extracted_date は RPC 内で JST 日付。unique(source_message_id, title) 競合は duplicate=true で冪等成功。
 */
export async function createInstantDigestTask(
  input: CreateInstantDigestTaskInput,
): Promise<CreateInstantDigestTaskResult> {
  const { data, error } = await admin()
    .rpc('rpc_create_instant_digest_task', {
      p_group_id: input.groupId,
      p_source_message_id: input.sourceMessageId,
      p_title: input.title,
      p_assignee_hint: input.assigneeHint ?? null,
      p_assignee_external_user_id: input.assigneeExternalUserId ?? null,
      p_assignee_identity_id: input.assigneeIdentityId ?? null,
      p_due_date: input.dueDate ?? null,
      p_due_time: input.dueTime ?? null,
    })
    .single()

  if (error) throw new Error(`rpc_create_instant_digest_task failed: ${error.message}`)
  const row = data as { id: string | null; is_pending: boolean; is_duplicate: boolean }
  return { id: row.id ?? null, pending: Boolean(row.is_pending), duplicate: Boolean(row.is_duplicate) }
}

/**
 * 配信前の自己修復スイープ（Stage 2.6 fix）: identity作成と申し送りINSERTがすれ違って
 * 担当identityがnullのまま残った分を、同一spaceのidentityへ解決しなおす。
 * どの経路の取りこぼしも等しく吸収できるため、各INSERT経路をロックで直列化するより単純。
 */
export async function reconcileDigestAssignees(groupId: string): Promise<number> {
  const { data, error } = await admin().rpc('rpc_reconcile_digest_assignees', {
    p_group_id: groupId,
  })
  if (error) throw new Error(`rpc_reconcile_digest_assignees failed: ${error.message}`)
  return (data as number) ?? 0
}

export interface NumberedDigestTask {
  id: string
  title: string
  digestNumber: number
  dueDate: string | null
  dueTime: string | null
  assigneeHint: string | null
}

/**
 * 配信直前の再採番: まず当該グループの digest_number を全行NULLクリアしてから、
 * openなタスクに 1..N を振り直す。
 * （「完了N」返信が常に最新世代のみにマッチし、昨日の一覧が今朝の別タスクを消さないため）
 *
 * 並びは「期限の近い順 → 期限なし」（Stage 2.6 §5）。digestは毎朝openを全件送るため、
 * 期限順に並べること自体が期限リマインドとして機能する（新しいcronを増やさない）。
 * 同着（同一期限・期限なし同士）は created_at 順で安定させる。
 */
export async function clearAndRenumberOpenDigestTasks(groupId: string): Promise<NumberedDigestTask[]> {
  const client = admin()
  // clear の失敗を握り潰すと、旧番号が残ったまま新番号を振れず「完了N」返信が別タスクを指す。
  // 失敗は必ず伝播させ、cron 側で配信をスキップさせる（誤配信より欠配信を選ぶ）。
  const clearRes = await client
    .from('channel_digest_tasks')
    .update({ digest_number: null })
    .eq('group_id', groupId)
  if (clearRes.error) {
    throw new Error(`clearAndRenumberOpenDigestTasks: clear failed: ${clearRes.error.message}`)
  }

  const { data, error } = await client
    .from('channel_digest_tasks')
    .select('id, title, created_at, due_date, due_time, assignee_hint')
    .eq('group_id', groupId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })

  // ★取得エラーは「0件」と区別して伝播させる（旧実装は error 時も [] を返し、
  //   open タスクがあるのに配信を握り潰していた）。
  if (error) {
    throw new Error(`clearAndRenumberOpenDigestTasks: select failed: ${error.message}`)
  }
  if (!data || data.length === 0) return []

  const rows = data as Array<{
    id: string
    title: string
    due_date: string | null
    due_time: string | null
    assignee_hint: string | null
  }>
  const numbered = rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      dueDate: row.due_date,
      dueTime: row.due_time,
      assigneeHint: row.assignee_hint,
    }))
    // created_at順の配列に対する安定ソート（Array.prototype.sortはES2019以降、安定であることが保証される）
    .sort((a, b) => dueSortKey(a.dueDate, a.dueTime) - dueSortKey(b.dueDate, b.dueTime))
    .map((row, index) => ({ ...row, digestNumber: index + 1 }))

  // 各番号更新の失敗も検査する（部分失敗のまま配信すると番号とDBがずれる）。
  const updateResults = await Promise.all(
    numbered.map((task) =>
      client.from('channel_digest_tasks').update({ digest_number: task.digestNumber }).eq('id', task.id),
    ),
  )
  const failed = updateResults.find((r) => r.error)
  if (failed?.error) {
    throw new Error(`clearAndRenumberOpenDigestTasks: renumber failed: ${failed.error.message}`)
  }

  return numbered
}

/**
 * メンションで取れたLINE userId を、既存の active identity に解決する（Stage 2.6 §1-1）。
 * identity が無い（＝まだ友だち追加していない）人は null。その場合も
 * assignee_external_user_id に生のuserIdを残すため、後日 backfill で人へ昇格できる。
 *
 * ★必ず space で絞る。channel_identities は「同一人物が複数顧問先の窓口になるケース
 * （社長が2法人経営等）」を space 違いで許容している（active一意は
 * (org_id, channel, external_id, space_id)）。org_id だけで引くと、A社のグループの
 * 申し送りにB社のidentityが付き、顧問先をまたいだ担当の誤帰属が起きる。
 *
 * spaceId が null（未紐付けグループ）なら解決しない。identity は space_id not null であり、
 * spaceが決まっていない以上その人が「どの顧問先の窓口か」を言えないため。
 */
export async function findIdentityIdsByExternalUserIds(
  orgId: string,
  spaceId: string | null,
  externalUserIds: string[],
): Promise<Map<string, string>> {
  if (!spaceId) return new Map()

  const unique = [...new Set(externalUserIds)]
  if (unique.length === 0) return new Map()

  const { data, error } = await admin()
    .from('channel_identities')
    .select('id, external_id')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .eq('channel', 'line')
    .eq('status', 'active')
    .in('external_id', unique)

  if (error || !data) return new Map()
  return new Map(
    (data as Array<{ id: string; external_id: string }>).map((row) => [row.external_id, row.id]),
  )
}

/**
 * 友だち追加でidentityができた人の、過去のopen申し送りを人へ紐付ける（Stage 2.6 §6）。
 * 失敗しても identity 作成自体は成立させたいため、呼び出し側で握りつぶす前提。
 * done済みの履歴は書き換えない（RPC側でopenのみ対象）。
 */
export async function backfillDigestAssigneeIdentity(identityId: string): Promise<number> {
  const { data, error } = await admin().rpc('rpc_backfill_digest_assignee_identity', {
    p_identity_id: identityId,
  })
  if (error) throw new Error(`rpc_backfill_digest_assignee_identity failed: ${error.message}`)
  return (data as number) ?? 0
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

// ---------------------------------------------------------------------------
// 内部ユーザーの LINE 本人紐付け（Stage 2.7-A）
//
// channel_identities（space_id 必須＝顧問先の窓口）とは別軸。
// こちらは auth.users に紐づく「社内の人」であり、承認の本人性の土台になる。
// ---------------------------------------------------------------------------

export type ConsumeUserLinkStatus = 'ok' | 'invalid' | 'expired' | 'locked' | 'conflict'

export interface UserLink {
  id: string
  orgId: string
  userId: string
  channelAccountId: string
  externalUserId: string
  linkedAt: string
}

/** 発行: ログイン中の本人が自分の分だけ。平文は呼び出し側が一度だけ返し、DBにはハッシュのみ残る */
export async function createUserLinkCode(
  orgId: string,
  userId: string,
  channelAccountId: string,
  codeHash: string,
): Promise<void> {
  const { error } = await admin().from('channel_user_link_codes').insert({
    org_id: orgId,
    user_id: userId,
    channel_account_id: channelAccountId,
    code_hash: codeHash,
  })
  if (error) throw new Error(`channel_user_link_codes: insert failed: ${error.message}`)
}

/**
 * 消費。RPC は例外を投げず status で返す（例外だと試行履歴がロールバックされ、総当たり対策が壊れる）。
 */
export async function consumeUserLinkCode(
  codeHash: string,
  channelAccountId: string,
  externalUserId: string,
): Promise<{ status: ConsumeUserLinkStatus; linkId: string | null }> {
  const { data, error } = await admin().rpc('rpc_consume_user_link_code', {
    p_code_hash: codeHash,
    p_channel_account_id: channelAccountId,
    p_external_user_id: externalUserId,
  })
  if (error) throw new Error(`rpc_consume_user_link_code failed: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  return { status: (row?.status ?? 'invalid') as ConsumeUserLinkStatus, linkId: row?.link_id ?? null }
}

/**
 * グループに晒された内部コードを即座に失効させる。
 * 誤爆（1:1に送るべきコードをグループへ貼ってしまう）は起きる。見た人が使えてはならない。
 */
export async function expireUserLinkCode(codeHash: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('channel_user_link_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .select('id')
  if (error) throw new Error(`channel_user_link_codes: expire failed: ${error.message}`)

  // 0件 = 該当コードが無い / 既に使用済み。呼び出し側が「無効化しました」と断言しないよう返す
  return (data?.length ?? 0) > 0
}

/** LINE userId から内部ユーザーを解決する。承認時のアクター解決に使う（revoke 済みは解決しない） */
export async function findActiveUserLinkByExternalId(
  channelAccountId: string,
  externalUserId: string,
): Promise<UserLink | null> {
  const { data, error } = await admin()
    .from('channel_user_links')
    .select('id, org_id, user_id, channel_account_id, external_user_id, linked_at')
    .eq('channel_account_id', channelAccountId)
    .eq('external_user_id', externalUserId)
    .is('revoked_at', null)
    .maybeSingle()
  if (error) throw new Error(`channel_user_links: select failed: ${error.message}`)
  if (!data) return null

  return {
    id: data.id as string,
    orgId: data.org_id as string,
    userId: data.user_id as string,
    channelAccountId: data.channel_account_id as string,
    externalUserId: data.external_user_id as string,
    linkedAt: data.linked_at as string,
  }
}

/**
 * 即時1:1送信のための "単一候補 claim"（Stage 2.7-B §4-5）。cron の一括 claim の単票版。
 * 対象が pending かつ未通知で、requested_to が *現在も* 承認権限を持ち（org在籍＋対象spaceの
 * admin/editor、かつ現責任者と一致）、有効な1:1紐付けがある場合にのみ、approval_notified_at を
 * 原子的に刻んで送信先 external_user_id を返す。それ以外は null（印を打たない→cron/コンソールへ委ねる）。
 *
 * 認可を RPC 側（_digest_actor_can_approve）に一元化することで、退職・space外しの承認者へ
 * タイトルを 1:1 で漏らさない。行ロックで cron ディスパッチャとの二重送信も防ぐ。
 */
export async function claimApprovalNotification(taskId: string): Promise<string | null> {
  const { data, error } = await admin().rpc('rpc_claim_approval_notification', {
    p_task_id: taskId,
  })
  if (error) throw new Error(`rpc_claim_approval_notification failed: ${error.message}`)
  return (data as string | null) ?? null
}

/**
 * 即時1:1送信が失敗した pending 候補を未通知に戻す（Stage 2.7-B）。claim で刻んだ
 * approval_notified_at を NULL に戻し、cron ディスパッチャ／コンソールが拾えるようにする。
 * cron 送信と同一の LINE retryKey を使うため、初回が実は届いていても再送は LINE 側で冪等化される。
 */
export async function clearApprovalNotifiedAt(taskId: string): Promise<void> {
  const { error } = await admin()
    .from('channel_digest_tasks')
    .update({ approval_notified_at: null })
    .eq('id', taskId)
  if (error) throw new Error(`channel_digest_tasks: clear approval_notified_at failed: ${error.message}`)
}

/** 失効の認可に使う（org境界と所有者の確認）。revoke 済みも返す */
export async function findUserLinkById(linkId: string): Promise<UserLink | null> {
  const { data, error } = await admin()
    .from('channel_user_links')
    .select('id, org_id, user_id, channel_account_id, external_user_id, linked_at')
    .eq('id', linkId)
    .maybeSingle()
  if (error) throw new Error(`channel_user_links: select failed: ${error.message}`)
  if (!data) return null

  return {
    id: data.id as string,
    orgId: data.org_id as string,
    userId: data.user_id as string,
    channelAccountId: data.channel_account_id as string,
    externalUserId: data.external_user_id as string,
    linkedAt: data.linked_at as string,
  }
}

/** コンソール表示用。org 内の active な紐付け一覧 */
export async function listActiveUserLinks(orgId: string): Promise<UserLink[]> {
  const { data, error } = await admin()
    .from('channel_user_links')
    .select('id, org_id, user_id, channel_account_id, external_user_id, linked_at')
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .order('linked_at', { ascending: false })
  if (error) throw new Error(`channel_user_links: list failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id as string,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    channelAccountId: row.channel_account_id as string,
    externalUserId: row.external_user_id as string,
    linkedAt: row.linked_at as string,
  }))
}

/**
 * 現在ユーザー自身の active な LINE 紐付けが存在するか。オンボーディング進捗
 * (SetupChecklist の connect_line ステップ) の完了判定に使う。
 */
export async function hasActiveUserLinkForUser(orgId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('channel_user_links')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .limit(1)
  if (error) throw new Error(`channel_user_links: user link check failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * 現在ユーザー自身の active な LINE 紐付けが「DM到達不能」マーク済み(dm_unreachable_at 非NULL)か。
 * オンボーディング/秘書コンソールのLINE連携状態表示（line-status API）向け。webhookの
 * unfollow/follow(markDmUnreachable/clearDmUnreachable)と日次照合ジョブ
 * （dmReachabilityReconcile）が唯一の書き手で、ここは読み取り専用（存在判定のみ）。
 * 該当する active な紐付けが無い（未連携）場合も false（誤って「到達不能」を出さない）。
 */
export async function isDmUnreachableForUser(orgId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('channel_user_links')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .not('dm_unreachable_at', 'is', null)
    .limit(1)
  if (error) throw new Error(`channel_user_links: dm unreachable check failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * 現在ユーザー自身の active な LINE 紐付けを値で返す（hasActiveUserLinkForUser の値返し版）。
 * 期限リマインドの1:1 DM 宛先解決に使う（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md
 * §9 §A・PR-1）。同一ユーザーが同一org内で active にできるのは1件のみ
 * （channel_user_links_active_user unique index・20260715070647）なので、複数該当時の
 * 選択は発生しない（決定的）。
 */
export async function findActiveUserLinkForUser(
  orgId: string,
  userId: string,
): Promise<{ channelAccountId: string; externalUserId: string } | null> {
  const { data, error } = await admin()
    .from('channel_user_links')
    .select('channel_account_id, external_user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`channel_user_links: active link lookup failed: ${error.message}`)
  if (!data) return null

  const row = data as { channel_account_id: string; external_user_id: string }
  return { channelAccountId: row.channel_account_id, externalUserId: row.external_user_id }
}

/**
 * findActiveUserLinkForUser のバッチ版（存在判定のみ・値は返さない）。期限リマインドの
 * channel-digest 安全網（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §9）で、
 * 「担当者にDMルートがあるか」をper-task判定してdigest掲載要否を決めるために使う。
 *
 * MEDIUM-1是正（対称化）: sender側の宛先解決(resolveDmCandidate)は
 * findLineAccountByIdLookup で紐付け先アカウントが status='active' であることまで確認するが、
 * この関数はrevoked_atのみ見ておりaccountの有効性を見ていなかった（非対称）。account が
 * disabled（LINEブロック等での無効化を含む運用）だと「DMは届く」と誤判定し、digestの安全網
 * からタスクが漏れる。channel_accounts!inner(status) を埋め込み、active なaccountのみを
 * 「DMルートあり」として扱う。
 *
 * 穴是正（設計正本 §9.1・A案: webhook単独の対称ループ）: 上記の判定は account/紐付けの
 * *状態*（active/revoked）のみを見ており、LINE側で相手がBotをブロックした等の理由で
 * *実際には届かない*ケースを検知できなかった（channel_user_linksはactiveのまま＝
 * 「DMルートあり」と誤判定されdigestからも除外される。DM・digestどちらからも見えなくなる
 * 恒久的な可視性喪失）。
 *
 * ⚠ M-1是正: マーク/解除の唯一のトリガは webhook の `unfollow`(mark)/`follow`(clear)
 * （src/lib/channels/line/webhookHandler.ts）。push結果は成功・失敗いずれも根拠にしない
 * （LINEはブロック済み宛先にも2xxを返す仕様のため、push成功はDMが実際に届いた証拠に
 * ならない・H-1/H-1'）。ここで dm_unreachable_at is null を条件に加えることで、
 * webhookでマーク済みのlinkは「DMルート無し」とみなし、digestが拾い直す
 * （followで解除された時点でdigestの安全網から自動的に外れる）。
 */
export async function findUserIdsWithActiveLink(orgId: string, userIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return new Set()

  const { data, error } = await admin()
    .from('channel_user_links')
    .select('user_id, channel_accounts!inner(status)')
    .eq('org_id', orgId)
    .in('user_id', unique)
    .is('revoked_at', null)
    .is('dm_unreachable_at', null)
    .eq('channel_accounts.status', 'active')
  if (error) throw new Error(`channel_user_links: batch active link lookup failed: ${error.message}`)

  return new Set((data ?? []).map((row) => (row as { user_id: string }).user_id))
}

/**
 * DMの到達不能マーク（設計正本 §9.1・A案: webhook単独の対称ループ）。
 *
 * 唯一のトリガは src/lib/channels/line/webhookHandler.ts の unfollow（LINEブロック）。
 * push結果（成功/失敗いずれも）はトリガにしない — LINEはブロック済み宛先へのpushでも
 * 2xxを返し黙って捨てる仕様のため、push結果は到達性について何も語らない（H-1）。
 * findUserIdsWithActiveLink はこのフラグが立ったlinkを「DMルート無し」とみなし、
 * digestの期限セクション（安全網）に拾い直す。呼び出し側（webhook）はベストエフォートで
 * 呼ぶ想定（失敗しても本処理は継続する）。
 *
 * L-3是正: orgIdでも絞り込む。DM linkを持ちうるのは現状owner_type='org'のみで越境の実害は
 * 無いが、将来共通LINEで1:1が解禁され同一external_user_idが複数orgに跨る行を持つように
 * なった場合、1回のupdateが他orgの行まで書き換える事故を予防する（安価なうちに入れておく）。
 *
 * L-4是正: nowではなくevent.occurredAt（LINEイベントの発生時刻）を書く。followによる
 * clear側にイベント順序ガード（clearDmUnreachable参照）を掛けられるようにするための前提。
 * mark側自体には対称のガードを掛けていない — clearはNULLへ戻すため「いつ解除されたか」を
 * 保持する列が無く（追加は migration 対象で本PRの範囲外）、mark側で同等の順序保証をするには
 * 別列が要る。この列単独での順序保証が無い代わりに、呼び出し側
 * （src/lib/channels/line/webhookHandler.ts の unfollow 分岐・M-2是正）が
 * `recordSystemEvent`（externalMessageId=webhookEventIdでdedupe）を先に呼び、
 * `'duplicate'`（＝同一webhookEventIdの再送）ならmark自体を呼ばないことで、
 * 「followでclear済みのマークが同一unfollowの再送で復活し恒久固着する」事故を防いでいる。
 * つまり再送耐性はこの関数の呼び出し側の責務であり、この関数自体は「呼ばれたら書く」だけの
 * 薄いラッパに留める。
 */
export async function markDmUnreachable(
  orgId: string,
  channelAccountId: string,
  externalUserId: string,
  occurredAt: string,
): Promise<void> {
  const { error } = await admin()
    .from('channel_user_links')
    .update({ dm_unreachable_at: occurredAt })
    .eq('org_id', orgId)
    .eq('channel_account_id', channelAccountId)
    .eq('external_user_id', externalUserId)
    // L-0是正: 失効済み(revoked)linkは対象外にする（生きているlinkのみ状態を持たせる）。
    .is('revoked_at', null)
  if (error) throw new Error(`channel_user_links: mark dm_unreachable failed: ${error.message}`)
}

/**
 * DMの到達不能マーク解除（設計正本 §9.1・A案）。唯一のトリガは webhookHandler.ts の
 * follow（ブロック解除・再フォロー）。push成功はトリガにしない（markDmUnreachableのコメント
 * 参照・H-1/H-1'）。ブロック解除で再び届くようになった場合、followイベント受信時点で
 * digestの安全網から自動的に外れ元の経路（DM）へ戻る。
 *
 * L-3是正: orgIdでも絞り込む（markDmUnreachableと同じ理由）。
 * L-4是正: イベント順序ガード。`dm_unreachable_at < event.occurredAt` のときだけ解除する
 * ＝現在のマークがこのfollowイベントより*前*に付けられたときのみ解除が成立する。これにより、
 * LINEの再送等で「新しいunfollow」の後に「古いfollow」が遅延到着しても、新しいマークを
 * 誤って消さない（古いfollowのoccurredAtはマーク時刻より前なので条件を満たさず解除されない）。
 * NULL行は `<` 比較を満たさないため、既にNULLの行を無駄に更新することもない
 * （旧`.not('dm_unreachable_at','is',null)`と等価以上の絞り込みを1条件で兼ねる）。
 */
export async function clearDmUnreachable(
  orgId: string,
  channelAccountId: string,
  externalUserId: string,
  occurredAt: string,
): Promise<void> {
  const { error } = await admin()
    .from('channel_user_links')
    .update({ dm_unreachable_at: null })
    .eq('org_id', orgId)
    .eq('channel_account_id', channelAccountId)
    .eq('external_user_id', externalUserId)
    // L-0是正: 失効済み(revoked)linkは対象外にする（生きているlinkのみ状態を持たせる）。
    .is('revoked_at', null)
    // L-1: `.lt`（`<`・`<=`ではない）なので同一ミリ秒（mark時刻 === このfollowのoccurredAt）
    // では解除されない。LINEのtimestampはミリ秒精度で、同一ユーザーのunfollowとfollowが
    // 同一ミリ秒に一致するのは実務上発生しない前提（もし発生しても次のイベントで解消する）。
    .lt('dm_unreachable_at', occurredAt)
  if (error) throw new Error(`channel_user_links: clear dm_unreachable failed: ${error.message}`)
}

export interface ActiveOrgDmLink {
  orgId: string
  accountId: string
  /** 復号済みの channel access token（既存の decryptAccount と同じ復号作法） */
  accessToken: string
  externalUserId: string
  dmUnreachableAt: string | null
}

/**
 * 日次照合ジョブ（dmReachabilityReconcile・安全網の仕上げ）専用: owner_type='org'
 * （自社LINE。DMは自社LINEアカウントのみが持つ・設計正本 §7）配下の active な1:1紐付け
 * (channel_user_links, revoked_at is null)を、復号済みaccessToken付きで一覧する。
 *
 * webhookのunfollow/follow（markDmUnreachable/clearDmUnreachableの唯一のトリガ）は
 * 「導入前から既にブロック済み」「unfollowイベント自体の取りこぼし」を拾えない。この一覧を
 * 使い、LINE 1:1 profile取得（fetchLineUserProfile）で実際の到達可否を照合し直す。
 *
 * account側はstatus='active'のみ対象（disabledはpush自体が止まっており照合の意味が無い）。
 * 同一accountを指す行が複数あっても復号(decrypt_system_secret RPC)は1回にまとめる
 * （accountCacheで重複排除）。復号に失敗したaccountの行はベストエフォートでスキップする
 * （他accountの行の処理は継続する）。
 */
export async function listActiveOrgDmLinks(): Promise<ActiveOrgDmLink[]> {
  const { data, error } = await admin()
    .from('channel_user_links')
    .select(
      'org_id, channel_account_id, external_user_id, dm_unreachable_at, channel_accounts!inner(id, org_id, display_name, credentials_encrypted, status, owner_type)',
    )
    .is('revoked_at', null)
    .eq('channel_accounts.owner_type', 'org')
    .eq('channel_accounts.status', 'active')
  if (error) throw new Error(`channel_user_links: list active org dm links failed: ${error.message}`)
  if (!data) return []

  type Row = {
    org_id: string
    channel_account_id: string
    external_user_id: string
    dm_unreachable_at: string | null
    channel_accounts: AccountRow | AccountRow[] | null
  }

  const accountCache = new Map<string, LineAccount | null>()
  const results: ActiveOrgDmLink[] = []
  for (const row of data as unknown as Row[]) {
    const accRow = Array.isArray(row.channel_accounts) ? row.channel_accounts[0] : row.channel_accounts
    if (!accRow) continue

    let account = accountCache.get(accRow.id)
    if (account === undefined) {
      account = await decryptAccount(accRow)
      accountCache.set(accRow.id, account)
    }
    if (!account) continue

    results.push({
      orgId: row.org_id,
      accountId: row.channel_account_id,
      accessToken: account.accessToken,
      externalUserId: row.external_user_id,
      dmUnreachableAt: row.dm_unreachable_at,
    })
  }
  return results
}

/**
 * org がユーザー自身でLINE秘書を連携し始められる状態か（＝連携先Botが用意されているか）。
 * org専用bot(owner_type='org') か 共有bot(owner_type='platform') のどちらかが active なら true。
 * false のときは白ラベルBotが未プロビジョニング（運営作業待ち）で、オンボーディングでは
 * connect_line を「準備中」表示にする。**資格情報は返さず存在判定のみ**。
 */
export async function isLineSelfServeReady(orgId: string): Promise<boolean> {
  const { data: orgAcc, error: orgErr } = await admin()
    .from('channel_accounts')
    .select('id')
    .eq('org_id', orgId)
    .eq('channel', 'line')
    .eq('status', 'active')
    .limit(1)
  if (orgErr) throw new Error(`channel_accounts: org line readiness check failed: ${orgErr.message}`)
  if ((orgAcc?.length ?? 0) > 0) return true

  const { data: platformAcc, error: platformErr } = await admin()
    .from('channel_accounts')
    .select('id')
    .eq('channel', 'line')
    .eq('owner_type', 'platform')
    .eq('status', 'active')
    .limit(1)
  if (platformErr) {
    throw new Error(`channel_accounts: platform line readiness check failed: ${platformErr.message}`)
  }
  return (platformAcc?.length ?? 0) > 0
}

/**
 * 共通LINE の org 単位 利用状態（own/granted/requested/none/unavailable）を返す。
 * isLineSelfServeReady の per-org 版。line-status API・checklist・claim gating が使う。
 * 判定は純関数 deriveLineSelfServeState に委譲（このフックは3ファクトの取得のみ）。
 */
export async function getLineSelfServeState(orgId: string): Promise<LineSelfServeState> {
  const [ownRes, platformRes, policyRes] = await Promise.all([
    admin()
      .from('channel_accounts')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel', 'line')
      .eq('status', 'active')
      .limit(1),
    admin()
      .from('channel_accounts')
      .select('id')
      .eq('channel', 'line')
      .eq('owner_type', 'platform')
      .eq('status', 'active')
      .limit(1),
    admin().from('org_channel_policy').select('shared_bot_access').eq('org_id', orgId).maybeSingle(),
  ])
  if (ownRes.error) throw new Error(`channel_accounts: own line readiness failed: ${ownRes.error.message}`)
  if (platformRes.error) {
    throw new Error(`channel_accounts: platform line readiness failed: ${platformRes.error.message}`)
  }
  if (policyRes.error) {
    throw new Error(`org_channel_policy: shared_bot_access read failed: ${policyRes.error.message}`)
  }

  const sharedRaw = (policyRes.data as { shared_bot_access?: string } | null)?.shared_bot_access
  const sharedBotAccess = sharedRaw === 'granted' || sharedRaw === 'requested' ? sharedRaw : 'none'

  return deriveLineSelfServeState({
    hasOwnActiveLineAccount: (ownRes.data?.length ?? 0) > 0,
    hasPlatformActiveLineAccount: (platformRes.data?.length ?? 0) > 0,
    sharedBotAccess,
  })
}

/**
 * 共通LINE の利用を org 側から申し込む（none→requested）。冪等（granted/requested は no-op）。
 * granted を絶対に downgrade しない（先に現状を読んでガード）。付与(→granted)は ops(service role)のみ。
 *
 * 戻り値の `transitioned` は「今回この呼び出しで実際に none→requested へ遷移したか」。
 * 呼び出し側は**これが true のときだけ運営へ通知**する（再申込の連打で運営のメールを溢れさせない）。
 */
export async function requestSharedBotAccess(
  orgId: string,
  userId: string,
): Promise<{ access: 'requested' | 'granted'; transitioned: boolean }> {
  const { data, error } = await admin()
    .from('org_channel_policy')
    .select('shared_bot_access')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw new Error(`org_channel_policy: read failed: ${error.message}`)
  const current = (data as { shared_bot_access?: string } | null)?.shared_bot_access
  if (current === 'granted') return { access: 'granted', transitioned: false }
  if (current === 'requested') return { access: 'requested', transitioned: false }

  const { error: upErr } = await admin()
    .from('org_channel_policy')
    .upsert(
      {
        org_id: orgId,
        shared_bot_access: 'requested',
        shared_bot_access_requested_at: new Date().toISOString(),
        shared_bot_access_requested_by: userId,
      },
      { onConflict: 'org_id' },
    )
  if (upErr) throw new Error(`org_channel_policy: request upsert failed: ${upErr.message}`)
  return { access: 'requested', transitioned: true }
}

export interface SharedBotAccessRequest {
  orgId: string
  orgName: string | null
  requestedAt: string | null
  requestedBy: string | null
}

/**
 * 共通LINE の開通待ち(requested)org 一覧を返す（superadmin の承認キュー用）。申込が古い順。
 * granted は開通済みなので含めない（キューは「対応が要るもの」だけ）。
 */
export async function listSharedBotAccessRequests(): Promise<SharedBotAccessRequest[]> {
  const { data, error } = await admin()
    .from('org_channel_policy')
    .select('org_id, shared_bot_access_requested_at, shared_bot_access_requested_by')
    .eq('shared_bot_access', 'requested')
    .order('shared_bot_access_requested_at', { ascending: true })
  if (error) throw new Error(`org_channel_policy: list requested failed: ${error.message}`)
  const rows = (data ?? []) as Array<{
    org_id: string
    shared_bot_access_requested_at: string | null
    shared_bot_access_requested_by: string | null
  }>
  if (rows.length === 0) return []

  const orgIds = rows.map((r) => r.org_id)
  const { data: orgs, error: orgErr } = await admin()
    .from('organizations')
    .select('id, name')
    .in('id', orgIds)
  if (orgErr) throw new Error(`organizations: name lookup failed: ${orgErr.message}`)
  const nameById = new Map(
    ((orgs ?? []) as Array<{ id: string; name: string | null }>).map((o) => [o.id, o.name]),
  )

  return rows.map((r) => ({
    orgId: r.org_id,
    orgName: nameById.get(r.org_id) ?? null,
    requestedAt: r.shared_bot_access_requested_at,
    requestedBy: r.shared_bot_access_requested_by,
  }))
}

/**
 * 共通LINE(共有Bot) を org に開通付与する（none/requested → granted）。superadmin(ops)専用。
 * 冪等（granted は no-op）。granted_at/granted_by を刻む。granted を絶対に downgrade しない。
 * requestSharedBotAccess と対（none→requested→granted のライフサイクルの last mile）。
 */
export async function grantSharedBotAccess(
  orgId: string,
  grantedByUserId: string,
): Promise<'granted'> {
  const { data, error } = await admin()
    .from('org_channel_policy')
    .select('shared_bot_access')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw new Error(`org_channel_policy: read failed: ${error.message}`)
  const current = (data as { shared_bot_access?: string } | null)?.shared_bot_access
  if (current === 'granted') return 'granted'

  const { error: upErr } = await admin()
    .from('org_channel_policy')
    .upsert(
      {
        org_id: orgId,
        shared_bot_access: 'granted',
        shared_bot_access_granted_at: new Date().toISOString(),
        shared_bot_access_granted_by: grantedByUserId,
      },
      { onConflict: 'org_id' },
    )
  if (upErr) throw new Error(`org_channel_policy: grant upsert failed: ${upErr.message}`)
  return 'granted'
}

interface AccountWithBasicIdRow extends AccountRow {
  line_basic_id: string | null
}

/**
 * LINE友だち追加QR導線用のaccount行取得。org専用bot(owner_type='org')を優先し、
 * 無ければ共有bot(owner_type='platform')。identity(本人特定)には一切関与しない
 * （こちらは「Botを見つける」までの純粋加算UXの材料取得）。
 */
async function findLineAccountRowForBasicId(orgId: string): Promise<AccountWithBasicIdRow | null> {
  const { data: orgRow, error: orgErr } = await admin()
    .from('channel_accounts')
    .select(`${ACCOUNT_COLUMNS}, line_basic_id`)
    .eq('channel', 'line')
    .eq('owner_type', 'org')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  // org専用botのクエリが真のDBエラーを返したときは静かに共有botへ落とさずログを残す
  // （org専用botがあるのに共有bot文言が出る誤表示を招くため）。
  if (orgErr) console.error('channel_accounts: org line basic_id lookup failed', orgId, orgErr)
  if (!orgErr && orgRow) return orgRow as AccountWithBasicIdRow

  const { data: platformRow, error: platformErr } = await admin()
    .from('channel_accounts')
    .select(`${ACCOUNT_COLUMNS}, line_basic_id`)
    .eq('channel', 'line')
    .eq('owner_type', 'platform')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  if (platformErr || !platformRow) return null
  return platformRow as AccountWithBasicIdRow
}

/**
 * 友だち追加QR/URL用の basic_id（公開情報）を取得する。**resultはbasic_id文字列のみ**
 * （credentials/access_tokenは絶対に呼び出し元へ返さない）。
 *
 * identity(本人特定)の仕組みは一切変えない — ここで返すbasic_idはQRで
 * 「Botを見つけて友だち追加する手間」を消すためだけの純粋加算UXの材料。
 * 「友だち追加した瞬間に紐付く」わけではなく、本人特定は従来どおりコード返信方式のみが正。
 *
 * 1) 既に line_basic_id があればそれを返す（LINE APIを叩かない）。
 * 2) 無ければ credentials を復号 → fetchBotInfo で basicId を取得 →
 *    channel_accounts.line_basic_id をUPDATEしてから返す。
 * 3) account不在・復号失敗・fetchBotInfo失敗（いずれもベストエフォート）は null。
 */
async function resolveLineBasicIdForRow(row: AccountWithBasicIdRow): Promise<string | null> {
  if (row.line_basic_id) return row.line_basic_id

  const account = await decryptAccount(row)
  if (!account) return null

  const info = await fetchBotInfo(account.accessToken)
  if (!info) return null

  const { error } = await admin()
    .from('channel_accounts')
    .update({ line_basic_id: info.basicId })
    .eq('id', row.id)
  if (error) {
    console.error('channel_accounts: failed to backfill line_basic_id', row.id, error)
  }
  return info.basicId
}

export async function getLineBasicIdForOrg(orgId: string): Promise<string | null> {
  const row = await findLineAccountRowForBasicId(orgId)
  if (!row) return null
  return resolveLineBasicIdForRow(row)
}

/**
 * getLineBasicIdForOrg に加え、案内文言の分岐（org専用bot=「あなたの事務所専用のLINE秘書」/
 * 共有bot=「共通の秘書アカウント。コード送信が必ず必要」）用に owner_type も返す拡張版。
 * ロジック分岐は持ち込まない — UIの文言分岐だけがこの値を使う。line-status API
 * （bool専用・オンボーディング進捗判定）とは別関数・別用途（混同しないこと）。
 */
export async function getLineBasicIdWithOwnerTypeForOrg(
  orgId: string,
): Promise<{ basicId: string; ownerType: 'org' | 'platform' } | null> {
  const row = await findLineAccountRowForBasicId(orgId)
  if (!row) return null
  const basicId = await resolveLineBasicIdForRow(row)
  if (!basicId) return null
  return { basicId, ownerType: row.owner_type === 'platform' ? 'platform' : 'org' }
}

/** 失効。二重失効は false（副作用ゼロ） */
export async function revokeUserLink(linkId: string, actorUserId: string): Promise<boolean> {
  const { data, error } = await admin().rpc('rpc_revoke_user_link', {
    p_link_id: linkId,
    p_actor_user_id: actorUserId,
  })
  if (error) throw new Error(`rpc_revoke_user_link failed: ${error.message}`)
  return data === true
}

// -----------------------------------------------------------------------------
// 申し送り候補の責任者確認（Stage 2.7-B）
// RPC は例外を投げず status で返す（監査行を同一Txに残すため）。LINE経路は内部UUIDを
// 受け取らず external_user_id から解決し、RPC側で org/account/認可を束縛する。
// -----------------------------------------------------------------------------
export type DigestPromoteStatus = 'not_found' | 'forbidden' | 'conflict' | 'promoted'
export type DigestRejectStatus = 'not_found' | 'forbidden' | 'conflict' | 'rejected'

/** LINE経路の昇格。channel_account_id と external_user_id は webhook 検証済みの値のみ渡す */
export async function promoteDigestTaskViaLine(
  channelAccountId: string,
  externalUserId: string,
  taskId: string,
  assignSelf = false,
): Promise<{ status: DigestPromoteStatus; created: boolean; taskId: string | null }> {
  const { data, error } = await admin().rpc('rpc_promote_digest_task_via_line', {
    p_channel_account_id: channelAccountId,
    p_external_user_id: externalUserId,
    p_task_id: taskId,
    p_assign_self: assignSelf,
  })
  if (error) throw new Error(`rpc_promote_digest_task_via_line failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return {
    status: (row?.status ?? 'not_found') as DigestPromoteStatus,
    created: row?.created === true,
    taskId: row?.task_id ?? null,
  }
}

/** LINE経路の却下。 */
export async function rejectDigestTaskViaLine(
  channelAccountId: string,
  externalUserId: string,
  taskId: string,
): Promise<{ status: DigestRejectStatus }> {
  const { data, error } = await admin().rpc('rpc_reject_digest_task_via_line', {
    p_channel_account_id: channelAccountId,
    p_external_user_id: externalUserId,
    p_task_id: taskId,
  })
  if (error) throw new Error(`rpc_reject_digest_task_via_line failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { status: (row?.status ?? 'not_found') as DigestRejectStatus }
}

/**
 * コンソール経路の昇格。actorUserId はセッションから解決した内部ユーザー（信頼済み）。
 * RPC 内の _digest_actor_can_approve が「現責任者・org在籍・space admin/editor」を再検証するため、
 * 内部メンバーでも承認者本人でなければ forbidden になる（漏洩・越権を防ぐ）。
 */
export async function promoteDigestTask(
  taskId: string,
  actorUserId: string,
  assignSelf = false,
): Promise<{ status: DigestPromoteStatus; created: boolean; taskId: string | null }> {
  const { data, error } = await admin().rpc('rpc_promote_digest_task', {
    p_task_id: taskId,
    p_actor_user_id: actorUserId,
    p_assign_self: assignSelf,
  })
  if (error) throw new Error(`rpc_promote_digest_task failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return {
    status: (row?.status ?? 'not_found') as DigestPromoteStatus,
    created: row?.created === true,
    taskId: row?.task_id ?? null,
  }
}

/** コンソール経路の却下（昇格と対称）。 */
export async function rejectDigestTask(
  taskId: string,
  actorUserId: string,
): Promise<{ status: DigestRejectStatus }> {
  const { data, error } = await admin().rpc('rpc_reject_digest_task', {
    p_task_id: taskId,
    p_actor_user_id: actorUserId,
  })
  if (error) throw new Error(`rpc_reject_digest_task failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { status: (row?.status ?? 'not_found') as DigestRejectStatus }
}

export interface PendingApprovalItem {
  taskId: string
  title: string
  dueDate: string | null
  dueTime: string | null
  assigneeHint: string | null
  groupId: string
  groupName: string | null
  requestedAt: string | null
  approvalNotifiedAt: string | null
}

/**
 * コンソール「確認待ち」トレイの取得（Stage 2.7-B §5）。セッションユーザー宛の pending 候補を返す。
 *
 * 認可ファースト: rpc_list_pending_approvals が _digest_actor_can_approve を適用し、
 * 「*現在も* 承認権限を持つ」候補だけを返す。requested_to=本人 で絞るだけだと、責任者交代・
 * space外し・退職後に旧承認者へタイトル等が漏れる（承認/却下・LINE経路と同じガードを取得にも掛ける）。
 *
 * ★state ベースで引く（promotion_state='pending'）。approval_notified_at では絞らない:
 * 1:1送信済み/未送信/送信失敗（クラッシュで notified 刻み済みだが未達）に関わらず、
 * *まだ承認判断が済んでいない* 候補は全て出す。これが LINE 取りこぼしの確実なフォールバック。
 */
export async function listPendingApprovalsForUser(
  orgId: string,
  userId: string,
): Promise<PendingApprovalItem[]> {
  const { data, error } = await admin().rpc('rpc_list_pending_approvals', {
    p_org_id: orgId,
    p_actor_user_id: userId,
  })
  if (error) throw new Error(`rpc_list_pending_approvals failed: ${error.message}`)

  type Row = {
    task_id: string
    title: string
    due_date: string | null
    due_time: string | null
    assignee_hint: string | null
    group_id: string
    group_name: string | null
    requested_at: string | null
    approval_notified_at: string | null
  }
  return ((data as Row[]) ?? []).map((row) => ({
    taskId: row.task_id,
    title: row.title,
    dueDate: row.due_date,
    dueTime: row.due_time,
    assigneeHint: row.assignee_hint,
    groupId: row.group_id,
    groupName: row.group_name,
    requestedAt: row.requested_at,
    approvalNotifiedAt: row.approval_notified_at,
  }))
}

export interface PendingApprovalNotification {
  taskId: string
  orgId: string
  channelAccountId: string
  externalUserId: string
  title: string
  dueDate: string | null
  dueTime: string | null
}

/**
 * pending 承認候補のうち未通知で、責任者に有効な1:1紐付けがあるものを原子的に claim する。
 * claim した行には approval_notified_at が刻まれる（並行ディスパッチャで二重送信しない）。
 * 呼び出し側は account 単位で access token を解決し、返った external_user_id へ Flex を push する。
 */
export async function claimPendingApprovalNotifications(
  limit = 50,
): Promise<PendingApprovalNotification[]> {
  const { data, error } = await admin().rpc('rpc_claim_pending_approval_notifications', {
    p_limit: limit,
  })
  if (error) throw new Error(`rpc_claim_pending_approval_notifications failed: ${error.message}`)

  return (data ?? []).map((row: Record<string, unknown>) => ({
    taskId: row.task_id as string,
    orgId: row.org_id as string,
    channelAccountId: row.channel_account_id as string,
    externalUserId: row.external_user_id as string,
    title: row.title as string,
    dueDate: (row.due_date as string | null) ?? null,
    dueTime: (row.due_time as string | null) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// 汎用チャネル（LINE以外）: 資格情報の復号と identity 突合
//   非LINEチャネルの受信Webでaccountを解決するための、channel非依存の薄い経路。
//   LINE固有のchannel_secret/access_token必須検証を持つ decryptAccount とは別に、
//   任意の credentials JSON をそのまま返す（webhook_secret / bot_token 等を扱うため）。
// ---------------------------------------------------------------------------

export interface ChannelAccountCredentials {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  /** 復号済みの credentials JSON（キーはチャネル依存: bot_token / webhook_secret 等） */
  credentials: Record<string, string>
}

/**
 * account_id と channel を指定して資格情報を復号取得する（service role専用）。
 * disabled でも返す（inbound記録は継続する方針。LINEの findLineAccountByDestination と同様）。
 * 復号失敗・channel不一致・credentialsが非JSONは null。
 */
export async function findChannelAccountCredentials(
  accountId: string,
  channel: string,
): Promise<ChannelAccountCredentials | null> {
  const { data, error } = await admin()
    .from('channel_accounts')
    .select('id, org_id, display_name, credentials_encrypted, status, owner_type, channel')
    .eq('id', accountId)
    .eq('channel', channel)
    .maybeSingle()

  if (error || !data) return null
  const row = data as AccountRow & { channel: string }

  const { data: decrypted, error: decErr } = await admin().rpc('decrypt_system_secret', {
    encrypted: row.credentials_encrypted,
    secret: getEncryptionKey(),
  })
  if (decErr || !decrypted) {
    console.error('channel_accounts: failed to decrypt credentials', row.id, decErr)
    return null
  }

  let credentials: Record<string, string>
  try {
    const parsed = JSON.parse(decrypted as string)
    if (!parsed || typeof parsed !== 'object') return null
    credentials = parsed as Record<string, string>
  } catch {
    console.error('channel_accounts: credentials are not valid JSON', row.id)
    return null
  }

  return {
    id: row.id,
    channel: row.channel,
    orgId: row.org_id,
    ownerType: row.owner_type === 'platform' ? 'platform' : 'org',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    credentials,
  }
}

/**
 * (org, channel, external_id) の active identity を取得する（channel非依存）。
 * LINE の findIdentityIdsByExternalUserIds が channel='line' 固定なのに対し、
 * 任意チャネルの受信突合に使う。突合ルールは呼び出し側で「1件なら確定/0・複数はnull」を判断する。
 */
export async function findActiveIdentitiesByExternalId(
  orgId: string,
  channel: string,
  externalId: string,
): Promise<Array<{ id: string; spaceId: string }>> {
  const { data, error } = await admin()
    .from('channel_identities')
    .select('id, space_id')
    .eq('org_id', orgId)
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('status', 'active')

  if (error || !data) return []
  return (data as Array<{ id: string; space_id: string }>).map((r) => ({
    id: r.id,
    spaceId: r.space_id,
  }))
}

// =============================================================================
// Google Chat 全メッセージ購読状態（channel_event_subscriptions / PR-a）
//
// Workspace Events API の subscription の生存状態を持つ薄いCRUD。後続 PR-b 以降
// （Pub/Sub 受信・cron renew・create-missing）が使う。書込は全て service role 経由。
// updated_at は UPDATE 系で明示セットする（channel 表は auto-trigger を持たない慣行）。
// =============================================================================

/** channel_event_subscriptions の1行（row対応・camelCase） */
export interface ChannelEventSubscription {
  id: string
  orgId: string
  groupId: string
  accountId: string
  /** Google Chat 空間名 "spaces/XXX" */
  spaceName: string
  /** Events API subscription 名 "subscriptions/XXX"。作成前は null */
  subscriptionResourceName: string | null
  status: 'active' | 'expired' | 'broken' | 'deleted'
  expireTime: string | null
  lastRenewError: string | null
  createdAt: string
  updatedAt: string
}

interface EventSubscriptionRow {
  id: string
  org_id: string
  group_id: string
  account_id: string
  space_name: string
  subscription_resource_name: string | null
  status: string
  expire_time: string | null
  last_renew_error: string | null
  created_at: string
  updated_at: string
}

const EVENT_SUBSCRIPTION_COLUMNS =
  'id, org_id, group_id, account_id, space_name, subscription_resource_name, status, expire_time, last_renew_error, created_at, updated_at'

function toEventSubscriptionStatus(value: string): ChannelEventSubscription['status'] {
  return value === 'expired' || value === 'broken' || value === 'deleted' ? value : 'active'
}

function toChannelEventSubscription(row: EventSubscriptionRow): ChannelEventSubscription {
  return {
    id: row.id,
    orgId: row.org_id,
    groupId: row.group_id,
    accountId: row.account_id,
    spaceName: row.space_name,
    subscriptionResourceName: row.subscription_resource_name,
    status: toEventSubscriptionStatus(row.status),
    expireTime: row.expire_time,
    lastRenewError: row.last_renew_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 購読行を status='active'・resource_name=null で立てる（Events API 作成の直前）。
 * 部分unique(channel_event_subscriptions_active_group_unique)により、同一 group に
 * active が2件立つと 23505 になる。呼び出し側はそれを「既に購読あり」として扱う。
 */
export async function createEventSubscription(input: {
  orgId: string
  groupId: string
  accountId: string
  spaceName: string
}): Promise<{ id: string }> {
  const { data, error } = await admin()
    .from('channel_event_subscriptions')
    .insert({
      org_id: input.orgId,
      group_id: input.groupId,
      account_id: input.accountId,
      space_name: input.spaceName,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`channel_event_subscriptions: insert failed: ${error?.message ?? 'no row'}`)
  }
  return { id: (data as { id: string }).id }
}

/**
 * Events API 作成成功後に subscription リソース名と失効時刻を埋める（NULL→値）。
 */
export async function setEventSubscriptionResource(
  id: string,
  subscriptionResourceName: string,
  expireTime: string | null,
): Promise<void> {
  const { error } = await admin()
    .from('channel_event_subscriptions')
    .update({
      subscription_resource_name: subscriptionResourceName,
      expire_time: expireTime,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    throw new Error(`channel_event_subscriptions: set resource failed: ${error.message}`)
  }
}

/** group の active 購読を1件返す（status='active' のみ。無ければ null）。 */
export async function findActiveSubscriptionByGroup(
  groupId: string,
): Promise<ChannelEventSubscription | null> {
  const { data, error } = await admin()
    .from('channel_event_subscriptions')
    .select(EVENT_SUBSCRIPTION_COLUMNS)
    .eq('group_id', groupId)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) return null
  return toChannelEventSubscription(data as EventSubscriptionRow)
}

/**
 * lifecycle イベント（購読の期限/削除通知）の逆引き。subscription リソース名は
 * 部分unique のため高々1件。
 */
export async function findSubscriptionByResourceName(
  resourceName: string,
): Promise<ChannelEventSubscription | null> {
  const { data, error } = await admin()
    .from('channel_event_subscriptions')
    .select(EVENT_SUBSCRIPTION_COLUMNS)
    .eq('subscription_resource_name', resourceName)
    .maybeSingle()

  if (error || !data) return null
  return toChannelEventSubscription(data as EventSubscriptionRow)
}

/**
 * 購読を非activeへ落とす（expired/broken/deleted）。broken は拾いだけ止め、記録・digest・
 * 完了ループは壊さない（DDL コメント参照）。lastRenewError は診断用に任意で残す。
 */
export async function markSubscriptionStatus(
  id: string,
  status: 'expired' | 'broken' | 'deleted',
  lastRenewError?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (lastRenewError !== undefined) patch.last_renew_error = lastRenewError

  const { error } = await admin()
    .from('channel_event_subscriptions')
    .update(patch)
    .eq('id', id)

  if (error) {
    throw new Error(`channel_event_subscriptions: mark ${status} failed: ${error.message}`)
  }
}

/**
 * cron の create-missing 用: 購読を張るべきなのにまだ active 購読が無い
 * google_chat の claimed group（channel_groups の active 行）を列挙する。
 *
 * space_name の出所は channel_groups.external_group_id（Google Chat は "spaces/XXX" を
 * external_group_id に入れる）。active 購読の有無は、全 active 購読の group_id 集合との
 * 差分で判定する（google_chat スケールで有界。埋め込みJOINに依存せずモックしやすい）。
 */
export async function listActiveClaimedGroupsWithoutActiveSubscription(): Promise<
  Array<{ groupId: string; orgId: string; accountId: string; spaceName: string }>
> {
  const { data: groups, error: groupsError } = await admin()
    .from('channel_groups')
    .select('id, org_id, account_id, external_group_id')
    .eq('channel', 'google_chat')
    .eq('status', 'active')
    // Fable裁定: space確定（TaskApp space に紐付いた）claimed group のみ購読対象。
    // 拾ったメッセージの帰属先 space が無い group には購読を張らない（縮退の予防）。
    .not('space_id', 'is', null)

  if (groupsError) {
    throw new Error(`channel_groups: google_chat lookup failed: ${groupsError.message}`)
  }
  if (!groups || groups.length === 0) return []

  const { data: subs, error: subsError } = await admin()
    .from('channel_event_subscriptions')
    .select('group_id')
    .eq('status', 'active')

  if (subsError) {
    throw new Error(`channel_event_subscriptions: active lookup failed: ${subsError.message}`)
  }
  const claimed = new Set(
    ((subs ?? []) as Array<{ group_id: string }>).map((s) => s.group_id),
  )

  return (
    groups as Array<{
      id: string
      org_id: string
      account_id: string
      external_group_id: string
    }>
  )
    .filter((g) => !claimed.has(g.id))
    .map((g) => ({
      groupId: g.id,
      orgId: g.org_id,
      accountId: g.account_id,
      spaceName: g.external_group_id,
    }))
}

/**
 * cron の renew 用: 失効間近の active 購読を列挙する（status='active' かつ
 * expire_time < beforeIso）。expire_time が null（未設定）の行は対象外。
 */
export async function listSubscriptionsToRenew(
  beforeIso: string,
): Promise<ChannelEventSubscription[]> {
  const { data, error } = await admin()
    .from('channel_event_subscriptions')
    .select(EVENT_SUBSCRIPTION_COLUMNS)
    .eq('status', 'active')
    .lt('expire_time', beforeIso)

  if (error || !data) return []
  return (data as EventSubscriptionRow[]).map(toChannelEventSubscription)
}

/**
 * cron の delete-orphaned 用（PR-d）: status='active' の購読のうち、対応する
 * channel_groups が「space確定・active な google_chat グループ」でなくなったものを返す
 * （unlink/削除/space未紐付け化等で orphan 化したもの）。listActiveClaimedGroupsWithoutActiveSubscription
 * と対称の差分判定（active購読のgroup_id集合 − active claimed google_chat groupのid集合）。
 */
export async function listOrphanedActiveSubscriptions(): Promise<
  Array<{ id: string; subscriptionResourceName: string | null }>
> {
  const { data: subs, error: subsError } = await admin()
    .from('channel_event_subscriptions')
    .select('id, group_id, subscription_resource_name')
    .eq('status', 'active')

  if (subsError) {
    throw new Error(`channel_event_subscriptions: active lookup failed: ${subsError.message}`)
  }
  if (!subs || subs.length === 0) return []

  const { data: groups, error: groupsError } = await admin()
    .from('channel_groups')
    .select('id')
    .eq('channel', 'google_chat')
    .eq('status', 'active')
    .not('space_id', 'is', null)

  if (groupsError) {
    throw new Error(`channel_groups: google_chat lookup failed: ${groupsError.message}`)
  }
  const claimedGroupIds = new Set(((groups ?? []) as Array<{ id: string }>).map((g) => g.id))

  return (
    subs as Array<{ id: string; group_id: string; subscription_resource_name: string | null }>
  )
    .filter((s) => !claimedGroupIds.has(s.group_id))
    .map((s) => ({ id: s.id, subscriptionResourceName: s.subscription_resource_name }))
}
