/**
 * Telegram Bot API 受信Webhookのオーケストレーション。
 *
 * 認証設計（マルチテナント）:
 *   - Webhookは account 単位のパス /api/channels/telegram/webhook/{accountId} で受ける。
 *   - setWebhook 時に登録した secret_token を Telegram が X-Telegram-Bot-Api-Secret-Token
 *     ヘッダで送るので、accountの webhook_secret と定数時間比較で照合する。
 *   - LINE同様、未検証ボディは検証成立まで解釈しない（不一致は401・何も書かない）。
 *
 * 帰属導出:
 *   - v1は owner_type='org'（自社Bot）のみ対応。platformは org 解決不能なため400で弾く。
 *   - identity 突合は「(org, telegram, from.id) の active が1件なら space/identity 確定、
 *     0件/複数は null 記録（人力トリアージ）」— LINEのテキスト突合ルールと一致させる。
 *
 * Telegram の再送を避けるため、署名不一致(401)以外は常に200を返す。
 */
import { timingSafeEqual } from 'node:crypto'

export interface TelegramAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
}

export interface TelegramInsertInput {
  orgId: string
  spaceId: string | null
  identityId: string | null
  accountId: string
  channel: 'telegram'
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

export interface TelegramWebhookDeps {
  loadAccount: (accountId: string) => Promise<TelegramAccount | null>
  findIdentities: (
    orgId: string,
    externalId: string,
  ) => Promise<Array<{ id: string; spaceId: string }>>
  insertMessage: (input: TelegramInsertInput) => Promise<{ id: string } | 'duplicate'>
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

interface TgMessage {
  message_id?: number
  from?: { id?: number }
  chat?: { id?: number }
  date?: number
  text?: string
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

  const chatId = String(msg.chat.id)
  const externalUserId = msg.from?.id != null ? String(msg.from.id) : null

  // identity 突合（1件のみ確定）
  let spaceId: string | null = null
  let identityId: string | null = null
  if (externalUserId) {
    const identities = await deps.findIdentities(account.orgId, externalUserId)
    if (identities.length === 1) {
      spaceId = identities[0].spaceId
      identityId = identities[0].id
    }
  }

  const occurredAt = msg.date
    ? new Date(msg.date * 1000).toISOString()
    : new Date(0).toISOString()

  await deps.insertMessage({
    orgId: account.orgId,
    spaceId,
    identityId,
    accountId: account.id,
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

  return { status: 200, body: { ok: true } }
}
