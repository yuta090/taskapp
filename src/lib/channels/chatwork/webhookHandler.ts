/**
 * Chatwork Webhook v2 受信のオーケストレーション。
 *
 * 認証設計（マルチテナント）— Telegram と同じ account 単位パス方式:
 *   - Webhookは /api/channels/chatwork/webhook/{accountId} で account を特定してから、
 *     その account の webhook_token で署名検証する（固定パスでの「どの org の秘密で検証するか」
 *     という未検証テナント推測を避ける。パスが account を確定させる）。
 *   - Chatwork の webhook_token は base64 で配布される。署名は
 *     base64( HMAC-SHA256( rawBody, base64decode(webhook_token) ) ) を
 *     X-ChatWorkWebhookSignature ヘッダで送ってくる。生ボディに対し定数時間比較で照合する。
 *   - 未検証ボディは検証成立まで一切解釈しない（不一致/未知/秘密未設定は401・何も書かない）。
 *
 * 帰属導出:
 *   - v1は owner_type='org'（自社アカウント）のみ。platform は org 解決不能なため400で弾く。
 *   - identity 突合は (org, chatwork, webhook_event.account_id) の active が1件なら space/identity 確定、
 *     0件/複数は null 記録（人力トリアージ）— Telegram/LINE と一致させる。
 *
 * Chatwork の再送を避けるため、署名不一致(401)/platform(400) 以外は常に200を返す。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface ChatworkAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
}

export interface ChatworkInsertInput {
  orgId: string
  spaceId: string | null
  identityId: string | null
  accountId: string
  channel: 'chatwork'
  direction: 'inbound'
  actor: 'client'
  externalUserId: string | null
  externalMessageId: string
  contentType: string
  body: string | null
  payload: Record<string, unknown>
  storagePath: null
  status: 'received'
  error: null
  occurredAt: string
}

export interface ChatworkWebhookDeps {
  loadAccount: (accountId: string) => Promise<ChatworkAccount | null>
  findIdentities: (
    orgId: string,
    externalId: string,
  ) => Promise<Array<{ id: string; spaceId: string }>>
  insertMessage: (input: ChatworkInsertInput) => Promise<{ id: string } | 'duplicate'>
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Chatwork Webhook v2 署名（base64(HMAC-SHA256(rawBody, base64decode(token)))）の検証 */
function verifySignature(rawBody: string, webhookTokenB64: string, header: string): boolean {
  let key: Buffer
  try {
    key = Buffer.from(webhookTokenB64, 'base64')
  } catch {
    return false
  }
  if (key.length === 0) return false
  const expected = createHmac('sha256', key).update(rawBody, 'utf8').digest('base64')
  return safeEqual(expected, header)
}

/** message を伴うイベント型のみ取り込む（それ以外は無視） */
const MESSAGE_EVENT_TYPES = new Set(['message_created', 'mention_to_me'])

interface CwEvent {
  message_id?: string | number
  room_id?: string | number
  account_id?: string | number
  body?: string
  send_time?: number
}

export async function handleChatworkWebhook(
  accountId: string,
  rawBody: string,
  signatureHeader: string | null,
  deps: ChatworkWebhookDeps,
): Promise<WebhookResult> {
  const account = await deps.loadAccount(accountId)
  // 未知アカウント / webhook_token 未設定 / 署名不一致は一律401（存在秘匿・何も書かない）
  if (!account) return { status: 401, body: { error: 'unauthorized' } }
  const token = account.credentials.webhook_token
  if (!token || !signatureHeader || !verifySignature(rawBody, token, signatureHeader)) {
    return { status: 401, body: { error: 'unauthorized' } }
  }

  // v1: org-owned のみ。platform は org 解決不能のため受けない。
  if (account.ownerType !== 'org' || !account.orgId) {
    return { status: 400, body: { error: 'platform account not supported for chatwork inbound' } }
  }

  // 検証成立後にのみボディを解釈する。以降のパース/内容起因の失敗は200で握る（再送ループ回避）。
  let payload: { webhook_event_type?: string; webhook_event?: CwEvent }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return { status: 200, body: { ok: true, ignored: 'invalid json' } }
  }

  const eventType = payload.webhook_event_type
  const ev = payload.webhook_event
  if (!eventType || !MESSAGE_EVENT_TYPES.has(eventType) || !ev) {
    // message_updated / message_deleted / room_* 等はv1では無視（テキスト取り込みに限定）
    return { status: 200, body: { ok: true, ignored: 'unsupported event' } }
  }
  if (typeof ev.body !== 'string' || ev.message_id == null || ev.room_id == null) {
    return { status: 200, body: { ok: true, ignored: 'incomplete event' } }
  }

  const senderId = ev.account_id != null ? String(ev.account_id) : null

  // 自社Bot自身の発言をループ取り込みしない（bot_account_id を控えている場合のみ判定）。
  // 送信は別途 direction='outbound' で記録済みのため、これを inbound=client として二重記録しない。
  const botAccountId = account.credentials.bot_account_id
  if (botAccountId && senderId && botAccountId === senderId) {
    return { status: 200, body: { ok: true, ignored: 'self message' } }
  }

  const roomId = String(ev.room_id)

  // identity 突合（1件のみ確定）
  let spaceId: string | null = null
  let identityId: string | null = null
  if (senderId) {
    const identities = await deps.findIdentities(account.orgId, senderId)
    if (identities.length === 1) {
      spaceId = identities[0].spaceId
      identityId = identities[0].id
    }
  }

  const occurredAt = ev.send_time
    ? new Date(ev.send_time * 1000).toISOString()
    : new Date(0).toISOString()

  await deps.insertMessage({
    orgId: account.orgId,
    spaceId,
    identityId,
    accountId: account.id,
    channel: 'chatwork',
    direction: 'inbound',
    actor: 'client',
    externalUserId: senderId,
    // dedupe: room内で message_id は一意。webhook再送で変わらない。
    externalMessageId: `${roomId}:${ev.message_id}`,
    contentType: 'text',
    body: ev.body,
    payload: { room_id: roomId, event: ev, event_type: eventType },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt,
  })

  return { status: 200, body: { ok: true } }
}
