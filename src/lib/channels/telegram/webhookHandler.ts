/**
 * Telegram Bot API 受信Webhookのオーケストレーション。
 *
 * 認証設計（マルチテナント）:
 *   - Webhookは account 単位のパス /api/channels/telegram/webhook/{accountId} で受ける。
 *   - setWebhook 時に登録した secret_token を Telegram が X-Telegram-Bot-Api-Secret-Token
 *     ヘッダで送るので、accountの webhook_secret と定数時間比較で照合する。
 *   - 未検証ボディは検証成立まで解釈しない（不一致は401・何も書かない）。
 *
 * 帰属と保存（Slack(slack/webhookHandler.ts)と同じ骨格をclaimLimboCoreに乗せて移植したもの。
 * 共通ヘルパ抽出はしない＝Slack/Discord/Chatworkを触らないための意図的な重複）:
 *   - claimed（active channel_groups がある）チャット → group.orgId/spaceId で
 *     insertMessage（group_id 付き）。identityによる自動帰属は行わない（identityId常にnull）。
 *   - limbo（未 claim）→ 本文が claim コード正準形なら償還を試みる（claimLimboCore.processClaimLimbo）。
 *     コードでなければ完全沈黙（0行・無返信）。
 *   - コード不一致は固定文言＋レート制限（存在/理由を推測させない）。
 *
 * Telegram固有のPro ゲート・claim/完了コマンドのロジック正本は claimLimboCore.ts（Discord/Slack/
 * Chatwork/Telegram 共通）。文言・分岐順序はそちらを唯一の真実源とし、ここは re-export のみ行う。
 *
 * v1は owner_type='org' のみ対応。platformは org 解決不能なため400で弾く。
 * Bot自身の発言（from.is_bot=true）は自己ループ・他Bot多層防御のため無視する。
 *
 * Telegram の再送を避けるため、署名不一致(401)/platform(400) 以外は常に200を返す。
 */
import { timingSafeEqual } from 'node:crypto'
import {
  handleClaimedGroupMessage,
  handleLimboGroupMessage,
  type TutorialWiring,
} from '@/lib/channels/groupCommands'
import type {
  CreateInstantDigestTaskInput,
  CreateInstantDigestTaskResult,
} from '@/lib/channels/store'
import {
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
  ALREADY_DONE_TEXT,
  buildDigestDoneText,
} from '@/lib/channels/claimLimboCore'

export interface TelegramAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
  /** credentials.bot_username（登録時プローブで解決・DDLゼロ）。自分宛メンション判定に使う。未設定なら剥がさない。 */
  botUsername?: string
}

export interface TelegramActiveGroup {
  id: string
  orgId: string
  spaceId: string | null
  /** 登録直後の練習（対話型チュートリアル）用。前からある接続を巻き込まないための日時。 */
  createdAt?: string | null
  /** 同上。練習の進み具合の置き場所（channel_groups.metadata） */
  metadata?: Record<string, unknown> | null
  /**
   * 拾い方（channel_groups.pickup_mode）。**返事で嘘をつかないためだけに使う**。
   * 'off' のグループは毎朝のまとめ配信の対象外＝「次にお届けする一覧に載ります」が果たされない。
   */
  pickupMode?: string
}

export interface TelegramClaimCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

/** claimed チャットでの通常発言の記録入力。 */
export interface TelegramInsertInput {
  orgId: string
  spaceId: string | null
  identityId: null
  accountId: string
  groupId: string
  channel: 'telegram'
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
export interface TelegramOutboundInput {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: 'telegram'
  direction: 'outbound'
  actor: 'secretary'
  body: string
  payload: Record<string, unknown>
  status: 'sent' | 'failed'
  error: string | null
  occurredAt: string
}

/** sendMessage の返信結果。message_id は outbound記録の provider_message_id に残す。 */
export interface TelegramReplyResult {
  messageId: string | null
}

export interface TelegramWebhookDeps extends TutorialWiring {
  loadAccount: (accountId: string) => Promise<TelegramAccount | null>
  findActiveGroup: (accountId: string, chatId: string) => Promise<TelegramActiveGroup | null>
  insertMessage: (input: TelegramInsertInput) => Promise<{ id: string } | 'duplicate'>
  normalizeClaimCode: (content: string) => string | null
  hashClaimCode: (canonical: string) => string
  findValidClaimCode: (codeHash: string, accountId: string) => Promise<TelegramClaimCode | null>
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
    chatId: string,
    groupDisplayName: string | null,
    // 容量上限（RPCが同一Tx内でアトミックに強制・null=無制限）。ソフトチェックのレース対策。
    maxActiveGroups: number | null,
  ) => Promise<'linked' | 'already_linked' | 'rejected'>
  generateChallengeLabel: () => string
  registerInvalidAttempt: (accountId: string, chatId: string) => boolean
  reply: (botToken: string, chatId: string, text: string) => Promise<TelegramReplyResult>
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** 「タスク追加 ○○」でその場に申し送りタスクを1件作る */
  createInstantDigestTask: (input: CreateInstantDigestTaskInput) => Promise<CreateInstantDigestTaskResult>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: TelegramOutboundInput) => Promise<unknown>
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

// 返信文言・完了処理・limbo償還ロジックの正本は claimLimboCore.ts（Discord/Slack/Chatwork/Telegram
// 共通）。各テストが本ファイルから直接 import しているため re-export する（ローカル重複定義はしない）。
export {
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
  ALREADY_DONE_TEXT,
  buildDigestDoneText,
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

interface TgMessage {
  message_id?: number
  from?: { id?: number; is_bot?: boolean }
  chat?: { id?: number }
  date?: number
  text?: string
}

// Telegramのbotメンション表記(@{bot_username})。先頭一致のみ剥がす（文中の言及は対象外）。
const SELF_MENTION_PREFIX_RE = /^@([A-Za-z0-9_]+)/

/**
 * 先頭が「自分（Bot）宛」のメンションのときだけ剥がす。botUsername 未設定、または
 * 他人宛メンションのときは無加工で返す（fail-safe）。大文字小文字は無視して一致判定する。
 * メンションは宛先の指定であって合図ではない — 剥がした後の文字列を厳格文法
 * （parseDigestCompleteCommand）にそのまま渡すことで誤爆を防ぐ（呼び出し側の責務）。
 */
function stripSelfMention(content: string, botUsername: string | undefined): string {
  if (!botUsername) return content
  const match = content.match(SELF_MENTION_PREFIX_RE)
  if (!match || match[1].toLowerCase() !== botUsername.toLowerCase()) return content
  return content.slice(match[0].length)
}

/**
 * claimed チャットでの合図（完了N / ヘルプ / タスク追加）の振り分け。中身は
 * groupCommands.handleClaimedGroupMessage（7チャネル共通）。reply はテキストのみ受ける形に
 * 束縛し、sendMessage の message_id を providerMessageId として返す。
 */
async function handleGroupCommand(
  account: TelegramAccount,
  chatId: string,
  messageId: number | undefined,
  group: TelegramActiveGroup,
  sourceMessageId: string,
  commandText: string,
  externalUserId: string | null,
  deps: TelegramWebhookDeps,
): Promise<void> {
  const botToken = account.credentials.bot_token
  await handleClaimedGroupMessage(
    {
      orgId: group.orgId,
      spaceId: group.spaceId,
      accountId: account.id,
      groupId: group.id,
      channel: 'telegram',
      externalUserId,
      autoReplyTo: `${chatId}:${messageId}`,
      sourceMessageId,
      text: commandText,
      groupCreatedAt: group.createdAt ?? null,
      groupMetadata: group.metadata ?? null,
      // 拾い方=off のグループに「次にお届けする一覧に載ります」と嘘をつかないため
      pickupMode: group.pickupMode,
    },
    {
      completeDigestTask: deps.completeDigestTask,
      createInstantDigestTask: deps.createInstantDigestTask,
      reply: (text) =>
        deps.reply(botToken, chatId, text).then((r) => ({ providerMessageId: r.messageId })),
      insertOutbound: deps.insertOutbound,
      assignDigestNumbersToNewTasks: deps.assignDigestNumbersToNewTasks,
      updateGroupMetadata: deps.updateGroupMetadata,
      now: deps.now,
    },
  )
}

async function processLimbo(
  account: TelegramAccount,
  chatId: string,
  text: string | null,
  deps: TelegramWebhookDeps,
): Promise<{ claimCreated: boolean }> {
  const botToken = account.credentials.bot_token

  // 登録が成立したときだけ、成立文言の後ろに練習の入り口を1通足す（応答そのものは変えない）。
  return handleLimboGroupMessage(
    { accountId: account.id, externalGroupId: chatId, text, channel: 'telegram' },
    {
      normalizeClaimCode: deps.normalizeClaimCode,
      hashClaimCode: deps.hashClaimCode,
      findValidClaimCode: deps.findValidClaimCode,
      hasExternalChatChannels: deps.hasExternalChatChannels,
      externalChatGroupCapacity: deps.externalChatGroupCapacity,
      createPendingClaim: deps.createPendingClaim,
      redeemCodeOnly: deps.redeemCodeOnly,
      generateChallengeLabel: deps.generateChallengeLabel,
      registerInvalidAttempt: deps.registerInvalidAttempt,
      reply: (t) => deps.reply(botToken, chatId, t).then(() => undefined),
      findActiveGroup: deps.findActiveGroup,
      assignDigestNumbersToNewTasks: deps.assignDigestNumbersToNewTasks,
      updateGroupMetadata: deps.updateGroupMetadata,
      now: deps.now,
    },
  )
}

export async function handleTelegramWebhook(
  accountId: string,
  rawBody: string,
  secretTokenHeader: string | null,
  deps: TelegramWebhookDeps,
): Promise<WebhookResult> {
  const account = await deps.loadAccount(accountId)
  // 未知アカウント / secret未設定 / 不一致は一律401（存在を秘匿し、何も書かない）
  if (!account) return { status: 401, body: { error: 'unauthorized' } }
  const expected = account.credentials.webhook_secret
  if (!expected || !secretTokenHeader || !safeEqual(expected, secretTokenHeader)) {
    return { status: 401, body: { error: 'unauthorized' } }
  }

  // v1: org-owned のみ。platform は org 解決不能のため受けない。
  if (account.ownerType !== 'org' || !account.orgId) {
    return { status: 400, body: { error: 'platform account not supported for telegram inbound' } }
  }

  // 検証成立後にのみボディを解釈する。以降のパース/内容起因の失敗は200で握る（再送ループ回避）。
  let update: { message?: TgMessage }
  try {
    update = JSON.parse(rawBody)
  } catch {
    return { status: 200, body: { ok: true, ignored: 'invalid json' } }
  }

  const msg = update.message
  if (!msg || typeof msg.text !== 'string' || msg.chat?.id == null || msg.message_id == null) {
    // edited_message / callback_query / 非テキスト等はv1では無視（テキスト取り込みに限定）
    return { status: 200, body: { ok: true, ignored: 'unsupported update' } }
  }

  // 他Bot・自Botの多層防御（Discord骨格と同思想）。webhookの発信元は自Botではあり得ないが、
  // グループ内の他Botの発言まで拾ってしまうのを防ぐ。
  if (msg.from?.is_bot === true) {
    return { status: 200, body: { ok: true, ignored: 'bot message' } }
  }

  const chatId = String(msg.chat.id)
  const externalUserId = msg.from?.id != null ? String(msg.from.id) : null
  const occurredAt = msg.date
    ? new Date(msg.date * 1000).toISOString()
    : new Date(0).toISOString()

  const group = await deps.findActiveGroup(account.id, chatId)
  if (group) {
    // 「完了N」自体も通常の発言としてまず記録する（監査ログ・順序は変えない）
    const recorded = await deps.insertMessage({
      orgId: group.orgId,
      spaceId: group.spaceId,
      identityId: null,
      accountId: account.id,
      groupId: group.id,
      channel: 'telegram',
      direction: 'inbound',
      actor: 'client',
      externalUserId,
      // dedupe: 同一chat内でmessage_idは一意。webhook再送で変わらない。
      externalMessageId: `${chatId}:${msg.message_id}`,
      contentType: 'text',
      body: msg.text,
      payload: { chat_id: chatId, update: msg },
      storagePath: null,
      status: 'received',
      error: null,
      occurredAt,
    })

    if (recorded !== 'duplicate') {
      const commandText = stripSelfMention(msg.text, account.botUsername)
      await handleGroupCommand(
        account,
        chatId,
        msg.message_id,
        group,
        recorded.id,
        commandText,
        externalUserId,
        deps,
      )
    }
    return { status: 200, body: { ok: true } }
  }

  await processLimbo(account, chatId, msg.text, deps)
  return { status: 200, body: { ok: true } }
}
