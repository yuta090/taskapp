/**
 * Google Chat Pub/Sub 受信のオーケストレーション（PR-c）。
 *
 * 購読(PR-d)が張られると、スペースの全メッセージが Cloud Pub/Sub → push subscription で
 * HTTPS 届く。本ハンドラはそれを記録し、claimed スペースでは「完了N」も効かせる
 * （Google Chat の「拾い」が初めて成立するのが本PR）。
 *
 * Pub/Sub push body: `{ message: { data: <base64>, attributes?, messageId }, subscription }`。
 * `data` をbase64デコードすると CloudEvent（structured mode JSON）:
 *   `{ type, ..., data: { message?: <Chat message resource>, subscription?: <resource> } }`
 * （Fable設計正本のとおり。message/subscription は CloudEvent の `data` 直下）。
 *
 * claim = org帰属の正／subscription = 配送手段（PR-b webhookHandler と同じ不変条件）:
 *   - claimed（active channel_groups がある）スペース → group.orgId/spaceId で記録＋完了N。
 *   - limbo（未 claim）→ 無処理（記録0）。未claimスペースに購読は張られない設計だが、
 *     来ても沈黙する（床）。
 *
 * `sender.type === 'BOT'` のメッセージは無視（自Bot/他Botのループ防止）。
 *
 * dedupe鍵 = Chat message resource name（`spaces/*\/messages/*`・グローバル一意）。
 *
 * 1メッセージのDB失敗やイベント解釈失敗は try/catch で握り、常に処理を継続する
 * （Pub/Sub push は非2xxで再送ループするため、内容起因の失敗で500を返さない）。
 */

import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'
import { runDigestCompletion } from '@/lib/channels/claimLimboCore'

// --- Pub/Sub push envelope ---------------------------------------------------

export interface PubSubPushMessage {
  /** base64エンコードされた CloudEvent JSON */
  data?: string
  attributes?: Record<string, string>
  messageId?: string
}

export interface PubSubPushBody {
  message?: PubSubPushMessage
  subscription?: string
}

// --- CloudEvent（Workspace Events API）---------------------------------------

export interface ChatMessageSender {
  /** 'users/XXX' */
  name?: string
  type?: 'HUMAN' | 'BOT'
  displayName?: string
}

export interface ChatMessageAnnotation {
  type?: string // 'USER_MENTION' 等
  startIndex?: number
  length?: number
  userMention?: { user?: { name?: string; type?: 'HUMAN' | 'BOT' } }
}

/** Chat message resource（Workspace Events API 経由で届く最小の形）。 */
export interface ChatMessageResource {
  /** 'spaces/*\/messages/*'（dedupe鍵） */
  name?: string
  space?: { name?: string }
  sender?: ChatMessageSender
  text?: string
  /** timestamptz瞬時値。欠落/不正時は epoch にフォールバックする。 */
  createTime?: string
  annotations?: ChatMessageAnnotation[]
}

export interface ChatSubscriptionResource {
  /** 'subscriptions/XXX' */
  name?: string
}

export interface ChatCloudEventData {
  message?: ChatMessageResource
  subscription?: ChatSubscriptionResource
}

export interface ChatCloudEvent {
  type: string
  data?: ChatCloudEventData
}

// --- deps ---------------------------------------------------------------------

export interface GoogleChatIngestPlatformAccount {
  id: string
}

export interface GoogleChatIngestActiveGroup {
  id: string
  orgId: string
  spaceId: string | null
}

export interface GoogleChatInsertInput {
  orgId: string
  spaceId: string | null
  identityId: null
  accountId: string
  groupId: string
  channel: 'google_chat'
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
export interface GoogleChatOutboundInput {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: 'google_chat'
  direction: 'outbound'
  actor: 'secretary'
  body: string
  payload: Record<string, unknown>
  status: 'sent' | 'failed'
  error: string | null
  occurredAt: string
}

export interface GoogleChatSubscriptionRecord {
  id: string
}

export interface GoogleChatIngestDeps {
  loadPlatformAccount: () => Promise<GoogleChatIngestPlatformAccount | null>
  findActiveGroup: (accountId: string, spaceName: string) => Promise<GoogleChatIngestActiveGroup | null>
  insertMessage: (input: GoogleChatInsertInput) => Promise<{ id: string } | 'duplicate'>
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** スペースへ発言する。provider 発行id（無ければnull）を返す。 */
  reply: (spaceName: string, text: string) => Promise<{ providerMessageId: string | null }>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: GoogleChatOutboundInput) => Promise<unknown>
  findSubscriptionByResourceName: (
    resourceName: string,
  ) => Promise<GoogleChatSubscriptionRecord | null>
  markSubscriptionStatus: (
    id: string,
    status: 'expired' | 'broken' | 'deleted',
  ) => Promise<void>
}

export interface GoogleChatIngestResult {
  status: 200
}

const TYPE_MESSAGE_CREATED = 'google.workspace.chat.message.v1.created'
const TYPE_SUBSCRIPTION_EXPIRED = 'google.workspace.subscription.v1.expired'
const TYPE_SUBSCRIPTION_EXPIRATION_REMINDER = 'google.workspace.subscription.v1.expirationReminder'

function decodeCloudEvent(pushBody: PubSubPushBody): ChatCloudEvent | null {
  const data = pushBody.message?.data
  if (!data) return null
  try {
    const json = Buffer.from(data, 'base64').toString('utf-8')
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
      return null
    }
    return parsed as ChatCloudEvent
  } catch {
    return null
  }
}

/**
 * 先頭が「自Bot宛」の USER_MENTION のときだけ剥がす。Chat app はスペースにつき1つのため、
 * 先頭annotationが USER_MENTION かつ startIndex=0（または未設定=先頭扱い）かつ
 * userMention.user.type='BOT' なら自分宛とみなす（Discordのような bot_external_id 突合は
 * 不要 — 同一空間に複数botが同時にメンション対象となる構造ではないため）。
 * annotations が無い/形が違う場合は無加工で返す（fail-safe。厳格文法一致は
 * parseDigestCompleteCommand 側が担保するため、メンション除去自体は best-effort でよい）。
 */
function stripSelfMentionPrefix(message: ChatMessageResource): string {
  const text = message.text ?? ''
  const first = message.annotations?.[0]
  if (!first || first.type !== 'USER_MENTION') return text
  if ((first.startIndex ?? 0) !== 0) return text
  if (first.userMention?.user?.type !== 'BOT') return text
  const length = first.length ?? 0
  return text.slice(length)
}

async function handleMessageCreated(
  event: ChatCloudEvent,
  deps: GoogleChatIngestDeps,
): Promise<void> {
  const message = event.data?.message
  if (!message?.name || !message.space?.name) return
  // 自Bot/他Botのループ防止（多層防御。Pub/Sub側で除外されない想定で必ずここでも弾く）。
  if (message.sender?.type === 'BOT') return

  const account = await deps.loadPlatformAccount()
  if (!account) return

  const spaceName = message.space.name
  const group = await deps.findActiveGroup(account.id, spaceName)
  if (!group) return // limbo: 無処理（記録0）。未claimスペースに購読は張られない設計。

  // 不正/欠落 createTime のフォールバックは epoch（完全な timestamptz 瞬時値・toISOString不使用）。
  const occurredAt =
    message.createTime && !Number.isNaN(Date.parse(message.createTime))
      ? message.createTime
      : '1970-01-01T00:00:00.000Z'

  const recorded = await deps.insertMessage({
    orgId: group.orgId,
    // グループ発言の space は常にグループ由来のみ（発言者からの自動帰属はしない）
    spaceId: group.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'google_chat',
    direction: 'inbound',
    actor: 'client',
    externalUserId: message.sender?.name ?? null,
    externalMessageId: message.name, // message resource name（グローバル一意・dedupe鍵）
    contentType: 'text',
    body: message.text ?? null,
    payload: { space_name: spaceName, message_name: message.name, sender: message.sender ?? null },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt,
  })
  if (recorded === 'duplicate') return

  const commandText = stripSelfMentionPrefix(message)
  const digestNumber = parseDigestCompleteCommand(commandText)
  if (digestNumber === null) return

  await runDigestCompletion(
    {
      orgId: group.orgId,
      spaceId: group.spaceId,
      accountId: account.id,
      groupId: group.id,
      channel: 'google_chat',
      externalUserId: message.sender?.name ?? null,
      autoReplyTo: message.name,
    },
    digestNumber,
    {
      completeDigestTask: deps.completeDigestTask,
      reply: (text) => deps.reply(spaceName, text),
      insertOutbound: deps.insertOutbound,
    },
  )
}

async function handleSubscriptionExpired(
  event: ChatCloudEvent,
  deps: GoogleChatIngestDeps,
): Promise<void> {
  const resourceName = event.data?.subscription?.name
  if (!resourceName) return
  const sub = await deps.findSubscriptionByResourceName(resourceName)
  if (!sub) return
  await deps.markSubscriptionStatus(sub.id, 'expired')
}

/**
 * Pub/Sub push リクエストのボディを処理する。route 側で認証(verifyPush)を済ませたあとに呼ぶ。
 * 内容起因の失敗（デコード不能・DBエラー・未知type等）は全て握って {status:200} を返す
 * （Pub/Sub の再送ループを避けるため。認証失敗の応答コードは route 側の責務）。
 */
export async function handleGoogleChatIngest(
  pushBody: PubSubPushBody,
  deps: GoogleChatIngestDeps,
): Promise<GoogleChatIngestResult> {
  const event = decodeCloudEvent(pushBody)
  if (!event) return { status: 200 }

  try {
    switch (event.type) {
      case TYPE_MESSAGE_CREATED:
        await handleMessageCreated(event, deps)
        break
      case TYPE_SUBSCRIPTION_EXPIRED:
        await handleSubscriptionExpired(event, deps)
        break
      case TYPE_SUBSCRIPTION_EXPIRATION_REMINDER:
        // renew の正は cron(PR-d)。本PRでは記録のみ(no-op)。将来 best-effort renew を
        // 足す余地としてここに分岐だけ残す。
        console.info(
          '[google-chat-ingest] subscription expiration reminder (no-op)',
          event.data?.subscription?.name,
        )
        break
      default:
        // 未知/対象外のtypeは無視（ADDED_TO_SPACE相当・将来のイベント種別追加にも安全）。
        break
    }
  } catch (error) {
    console.error('[google-chat-ingest] event processing failed', error)
  }

  return { status: 200 }
}
