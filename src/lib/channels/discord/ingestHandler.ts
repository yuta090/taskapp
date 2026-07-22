/**
 * Discord 受信取り込みのオーケストレーション（LINE 共有bot platform 分岐と同じ骨格）。
 *
 * worker(Gateway) が正規化・自己(bot)除外したメッセージ配列を内部エンドポイントへ HMAC 付きで
 * POST する。認証はエンドポイント側(ingestAuth)で済ませ、本ハンドラは検証済みイベントのみ受ける。
 *
 * 帰属と保存（LINE共有botと同一不変条件）:
 *   - claimed（active channel_groups がある）チャンネル → group.orgId/spaceId で insertChannelMessage。
 *   - limbo（未 claim）→ 本文が claim コード正準形なら償還を試みる。コードでなければ完全沈黙（0行・無返信）。
 *   - コード不一致は固定文言＋レート制限（存在/理由を推測させない）。承認前は保存0行。
 *
 * Discord 固有の Pro ゲート（LINE共有botは Free だが Discord等の他チャットは Pro の売り）:
 *   - 新規紐付け（claim 作成 / code_only 償還）の直前に external_chat_channels と
 *     maxExternalChatGroups を検査。満たさなければ確立させない（＝固定の無効文言に畳む・情報を漏らさない）。
 *   - 既に active な group（claimed 経路）はゲートしない（既存は切らない）。
 *
 * dedupe=message snowflake（グローバル一意）。占有 guildId は payload に残す（external_parent_id への
 * 永続化は承認RPC側の対応が要るため v1 では未実施＝将来のguild単位機能用に確保）。
 */

import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'

export interface DiscordIngestAuthor {
  id: string
  isBot: boolean
  displayName?: string
}

export interface DiscordIngestEvent {
  type: string // 'message_create'
  guildId: string | null
  channelId: string
  messageId: string
  author: DiscordIngestAuthor
  content: string
  /** ISO8601（worker が Discord の createdAt を正規化）。timestamptz瞬時値。 */
  timestamp: string
}

export interface DiscordPlatformAccount {
  id: string
  botToken: string
  /** credentials.bot_external_id（DDLゼロ・Fable裁定 論点4）。自分宛メンション判定に使う。未設定なら剥がさない。 */
  botExternalId?: string
}

export interface DiscordActiveGroup {
  id: string
  orgId: string
  spaceId: string | null
}

export interface DiscordClaimCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

export interface DiscordInsertInput {
  orgId: string
  spaceId: string | null
  identityId: null
  accountId: string
  groupId: string
  channel: 'discord'
  direction: 'inbound'
  actor: 'client'
  externalUserId: string | null
  externalMessageId: string
  contentType: 'text'
  body: string | null
  payload: Record<string, unknown>
  storagePath: null
  status: 'received'
  error: null
  occurredAt: string
}

/** 秘書の発話（完了コマンドへの応答）の outbound 記録入力。 */
export interface DiscordOutboundInput {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: 'discord'
  direction: 'outbound'
  actor: 'secretary'
  body: string
  payload: Record<string, unknown>
  status: 'sent' | 'failed'
  error: string | null
  occurredAt: string
}

export interface DiscordIngestDeps {
  loadPlatformAccount: () => Promise<DiscordPlatformAccount | null>
  findActiveGroup: (accountId: string, channelId: string) => Promise<DiscordActiveGroup | null>
  insertMessage: (input: DiscordInsertInput) => Promise<{ id: string } | 'duplicate'>
  normalizeClaimCode: (content: string) => string | null
  hashClaimCode: (canonical: string) => string
  findValidClaimCode: (codeHash: string, accountId: string) => Promise<DiscordClaimCode | null>
  hasExternalChatChannels: (orgId: string) => Promise<boolean>
  externalChatGroupCapacity: (
    orgId: string,
  ) => Promise<{ activeCount: number; max: number | null }>
  createPendingClaim: (input: {
    linkCodeId: string
    accountId: string
    externalGroupId: string
    orgId: string
    spaceId: string
    challengeLabel: string
    groupDisplayNameSnapshot: string | null
  }) => Promise<{ challengeLabel: string | null }>
  redeemCodeOnly: (
    codeHash: string,
    accountId: string,
    channelId: string,
    groupDisplayName: string | null,
    // 容量上限（RPCが同一Tx内でアトミックに強制・null=無制限）。ソフトチェックのレース対策。
    maxActiveGroups: number | null,
  ) => Promise<'linked' | 'already_linked' | 'rejected'>
  generateChallengeLabel: () => string
  registerInvalidAttempt: (accountId: string, channelId: string) => boolean
  reply: (botToken: string, channelId: string, text: string) => Promise<void>
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: DiscordOutboundInput) => Promise<unknown>
}

// 返信文言。存在/理由/プランを推測させないため、無効系は同一文言に畳む（LINE §3 と同思想）。
export const INVALID_TEXT =
  'コードを確認できませんでした。番号が正しいか、期限切れでないかをご確認ください。'
export const CODE_ONLY_LINKED_TEXT =
  'このチャンネルを登録しました。以降のやり取りを記録します。'
export const CODE_ONLY_ALREADY_TEXT =
  'このチャンネルは既に別のコードで登録済みです。'
export function buildAcceptedText(challengeLabel: string): string {
  return (
    '受け付けました。管理画面での承認後に、このチャンネルの会話を記録します。' +
    `お問い合わせの際は確認番号「${challengeLabel}」をお伝えください。`
  )
}

// LINE の ALREADY_DONE_TEXT（line/webhookHandler.ts）と同一文言。line/webhookHandler.ts は
// LINE client・digest postback 等の重い依存を抱える巨大な処理ファイルで、文言1つのために
// Discord側からimportすると channel 間に不要な結合が生まれるため、ここで意図的に重複定義する
// （変更する場合は両方を揃える）。
export const ALREADY_DONE_TEXT = 'そのタスクは既に完了済みです。'

/** 完了コマンドで実際にタスクを完了できた場合の返信文言。LINEの記名Flexに相当するものは
 *  Discordには無いため、プレーンテキストで簡潔に伝える。 */
export function buildDigestDoneText(title: string): string {
  return `「${title}」を完了にしました。`
}

export interface DiscordIngestResult {
  processed: number
  inserted: number
  claimsCreated: number
}

function insertRecord(
  accountId: string,
  group: DiscordActiveGroup,
  ev: DiscordIngestEvent,
): DiscordInsertInput {
  // 不正/欠落 timestamp のフォールバックは epoch（完全な timestamptz 瞬時値・date-onlyずれ無関係）。
  // toISOString() は使わない（CLAUDE.md の date-only 禁止 grep tripwire 回避・リテラルで等価）。
  const occurredAt = ev.timestamp && !Number.isNaN(Date.parse(ev.timestamp))
    ? ev.timestamp
    : '1970-01-01T00:00:00.000Z'
  return {
    orgId: group.orgId,
    // グループ発言の space は常にグループ由来のみ（発言者からの自動帰属はしない）
    spaceId: group.spaceId,
    identityId: null,
    accountId,
    groupId: group.id,
    channel: 'discord',
    direction: 'inbound',
    actor: 'client',
    externalUserId: ev.author.id ?? null,
    externalMessageId: ev.messageId, // snowflake（グローバル一意）
    contentType: 'text',
    body: ev.content,
    payload: {
      channel_id: ev.channelId,
      guild_id: ev.guildId,
      author: ev.author,
      message_id: ev.messageId,
    },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt,
  }
}

// Discordのユーザー/Botメンション表記。先頭一致のみ剥がす（文中の言及は対象外）。
const SELF_MENTION_PREFIX_RE = /^<@!?(\d+)>/

/**
 * 先頭が「自分（Bot）宛」のメンションのときだけ剥がす。botExternalId 未設定、または
 * 他人宛メンションのときは無加工で返す（fail-safe）。
 * メンションは宛先の指定であって合図ではない — 剥がした後の文字列を厳格文法
 * （parseDigestCompleteCommand）にそのまま渡すことで誤爆を防ぐ（呼び出し側の責務）。
 */
function stripSelfMentionPrefix(content: string, botExternalId: string | undefined): string {
  if (!botExternalId) return content
  const match = content.match(SELF_MENTION_PREFIX_RE)
  if (!match || match[1] !== botExternalId) return content
  return content.slice(match[0].length)
}

/**
 * claimed グループでの「完了N」処理（LINE の handleDigestCompleteCommand と同骨格）。
 * 呼び出し元で本文は既に通常発言として記録済み（監査ログ）。ここでは完了実行と返信のみ行う。
 */
async function handleDigestCompleteCommand(
  account: DiscordPlatformAccount,
  ev: DiscordIngestEvent,
  group: DiscordActiveGroup,
  digestNumber: number,
  deps: DiscordIngestDeps,
): Promise<void> {
  const result = await deps.completeDigestTask(group.id, digestNumber, ev.author.id ?? null)
  const text = result ? buildDigestDoneText(result.title) : ALREADY_DONE_TEXT
  await deps.reply(account.botToken, ev.channelId, text)
  await deps.insertOutbound({
    orgId: group.orgId,
    spaceId: group.spaceId,
    accountId: account.id,
    groupId: group.id,
    channel: 'discord',
    direction: 'outbound',
    actor: 'secretary',
    body: text,
    payload: { autoReplyTo: ev.messageId },
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
  })
}

async function processLimbo(
  account: DiscordPlatformAccount,
  ev: DiscordIngestEvent,
  deps: DiscordIngestDeps,
): Promise<{ claimCreated: boolean }> {
  // (1) 本文がコード正準形ですらない通常発言は完全沈黙（無保存・無返信）
  if (!ev.content) return { claimCreated: false }
  const code = deps.normalizeClaimCode(ev.content)
  if (!code) return { claimCreated: false }

  const codeHash = deps.hashClaimCode(code)
  const linkCode = await deps.findValidClaimCode(codeHash, account.id)
  if (!linkCode) {
    // (2) 見つからない/期限切れ/消費済み/対象不一致は同一文言＋レート制限
    const limited = deps.registerInvalidAttempt(account.id, ev.channelId)
    if (!limited) await deps.reply(account.botToken, ev.channelId, INVALID_TEXT)
    return { claimCreated: false }
  }

  // Discord固有Proゲート: 新規紐付けの確立直前。満たさなければ確立させず無効文言に畳む（漏らさない）。
  const entitled = await deps.hasExternalChatChannels(linkCode.orgId)
  if (!entitled) {
    await deps.reply(account.botToken, ev.channelId, INVALID_TEXT)
    return { claimCreated: false }
  }
  const cap = await deps.externalChatGroupCapacity(linkCode.orgId)
  if (cap.max !== null && cap.activeCount >= cap.max) {
    await deps.reply(account.botToken, ev.channelId, INVALID_TEXT)
    return { claimCreated: false }
  }

  if (linkCode.bindingMode === 'code_only') {
    // 上のソフトチェックに加え、RPC へ上限を渡して確立をアトミックに強制（並行償還のレース対策）。
    const result = await deps.redeemCodeOnly(codeHash, account.id, ev.channelId, null, cap.max)
    const text =
      result === 'linked'
        ? CODE_ONLY_LINKED_TEXT
        : result === 'already_linked'
          ? CODE_ONLY_ALREADY_TEXT
          : INVALID_TEXT
    await deps.reply(account.botToken, ev.channelId, text)
    return { claimCreated: result === 'linked' }
  }

  // web_approval: pending claim を作り確認番号を返す（実際の紐付けは管理画面の承認RPC）
  const challengeLabel = deps.generateChallengeLabel()
  const claim = await deps.createPendingClaim({
    linkCodeId: linkCode.id,
    accountId: account.id,
    externalGroupId: ev.channelId,
    orgId: linkCode.orgId,
    spaceId: linkCode.spaceId,
    challengeLabel,
    groupDisplayNameSnapshot: null,
  })
  await deps.reply(
    account.botToken,
    ev.channelId,
    buildAcceptedText(claim.challengeLabel ?? challengeLabel),
  )
  return { claimCreated: true }
}

export async function handleDiscordIngest(
  events: DiscordIngestEvent[],
  deps: DiscordIngestDeps,
): Promise<DiscordIngestResult> {
  const account = await deps.loadPlatformAccount()
  // 共有Bot未設定なら何もしない（取り込み不能）。認証は上流で済んでいるが処理対象が無い。
  if (!account) return { processed: 0, inserted: 0, claimsCreated: 0 }

  let inserted = 0
  let claimsCreated = 0
  let processed = 0

  for (const ev of events) {
    if (ev.type !== 'message_create') continue
    // 自己/他bot は取り込まない（worker でも除外済み・多層防御）
    if (ev.author?.isBot) continue
    processed += 1

    // 1イベントの失敗（DBエラー等）がバッチ全体を巻き込まないよう個別に握る（LINE骨格と同じ）。
    // ここで握らないと poison pill が毎回 500 → worker がバッチ全体を無限再送し兄弟イベントも詰まる。
    try {
      const group = await deps.findActiveGroup(account.id, ev.channelId)
      if (group) {
        // 「完了N」自体も通常の発言としてまず記録する（監査ログ・順序は変えない）
        const recorded = await deps.insertMessage(insertRecord(account.id, group, ev))
        if (recorded !== 'duplicate') {
          inserted += 1
          if (ev.content) {
            const commandText = stripSelfMentionPrefix(ev.content, account.botExternalId)
            const digestNumber = parseDigestCompleteCommand(commandText)
            if (digestNumber !== null) {
              await handleDigestCompleteCommand(account, ev, group, digestNumber, deps)
            }
          }
        }
        continue
      }

      const { claimCreated } = await processLimbo(account, ev, deps)
      if (claimCreated) claimsCreated += 1
    } catch (error) {
      console.error('[discord-ingest] event processing failed', ev.messageId, error)
    }
  }

  return { processed, inserted, claimsCreated }
}
