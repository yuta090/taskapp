/**
 * WhatsApp Cloud API（Meta Graph）受信Webhookのオーケストレーション。
 *
 * 認証設計（マルチテナント）— Telegram/Chatwork と同じ account 単位パス方式:
 *   - Webhookは /api/channels/whatsapp/webhook/{accountId} で account を特定してから検証する。
 *   - GET(購読検証): Meta が hub.mode=subscribe / hub.verify_token / hub.challenge を送る。
 *     account の verify_token（登録時サーバー生成・オペレーターが App Dashboard に貼付）と
 *     定数時間比較し、一致すれば hub.challenge をそのまま返す（プレーンテキスト）。
 *   - POST(イベント): X-Hub-Signature-256: sha256=<hex(HMAC-SHA256(rawBody, app_secret))>。
 *     account の app_secret で生ボディに対し照合する。未設定/不一致/未知は401・何も書かない。
 *
 * 帰属導出:
 *   - v1は owner_type='org'（自社アカウント）のみ。platform は org 解決不能なため400で弾く。
 *   - identity 突合は (org, whatsapp, message.from=wa_id) の active が1件なら space/identity 確定、
 *     0件/複数は null 記録（人力トリアージ）— 他チャネルと一致させる。
 *   - v1はテキストのみ取り込む（image/audio/status 等は無視）。dedupeは wamid（グローバル一意）。
 *
 * Meta の再送を避けるため、署名不一致(401)/platform(400) 以外は常に200を返す。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface WhatsappAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
}

export interface WhatsappInsertInput {
  orgId: string
  spaceId: string | null
  identityId: string | null
  accountId: string
  channel: 'whatsapp'
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

export interface WhatsappWebhookDeps {
  loadAccount: (accountId: string) => Promise<WhatsappAccount | null>
  findIdentities: (
    orgId: string,
    externalId: string,
  ) => Promise<Array<{ id: string; spaceId: string }>>
  insertMessage: (input: WhatsappInsertInput) => Promise<{ id: string } | 'duplicate'>
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

/** GET購読検証の結果（body は challenge/エラーのプレーンテキスト） */
export interface SubscriptionResult {
  status: number
  body: string
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * GET /api/channels/whatsapp/webhook/{accountId} — 購読検証ハンドシェイク。
 * mode=subscribe かつ verify_token 一致で challenge を返す。それ以外は403。
 */
export async function verifyWhatsappSubscription(
  accountId: string,
  mode: string | null,
  verifyToken: string | null,
  challenge: string | null,
  deps: WhatsappWebhookDeps,
): Promise<SubscriptionResult> {
  const account = await deps.loadAccount(accountId)
  if (!account) return { status: 403, body: 'forbidden' }
  const expected = account.credentials.verify_token
  if (mode !== 'subscribe' || !expected || !verifyToken || !safeEqual(expected, verifyToken)) {
    return { status: 403, body: 'forbidden' }
  }
  return { status: 200, body: challenge ?? '' }
}

/** X-Hub-Signature-256（sha256=<hex>）を app_secret で照合 */
function verifySignature(rawBody: string, appSecret: string, header: string): boolean {
  const prefix = 'sha256='
  if (!header.startsWith(prefix)) return false
  const provided = header.slice(prefix.length)
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  return safeEqual(expected, provided)
}

interface WaMessage {
  from?: string
  id?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
}
interface WaChangeValue {
  messages?: WaMessage[]
  statuses?: unknown[]
}
interface WaEntry {
  changes?: Array<{ field?: string; value?: WaChangeValue }>
}

export async function handleWhatsappWebhook(
  accountId: string,
  rawBody: string,
  signatureHeader: string | null,
  deps: WhatsappWebhookDeps,
): Promise<WebhookResult> {
  const account = await deps.loadAccount(accountId)
  // 未知アカウント / app_secret 未設定 / 署名不一致は一律401（存在秘匿・何も書かない）
  if (!account) return { status: 401, body: { error: 'unauthorized' } }
  const appSecret = account.credentials.app_secret
  if (!appSecret || !signatureHeader || !verifySignature(rawBody, appSecret, signatureHeader)) {
    return { status: 401, body: { error: 'unauthorized' } }
  }

  // v1: org-owned のみ。platform は org 解決不能のため受けない。
  if (account.ownerType !== 'org' || !account.orgId) {
    return { status: 400, body: { error: 'platform account not supported for whatsapp inbound' } }
  }
  const orgId = account.orgId

  // 検証成立後にのみボディを解釈する。以降のパース/内容起因の失敗は200で握る（再送ループ回避）。
  let payload: { entry?: WaEntry[] }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return { status: 200, body: { ok: true, ignored: 'invalid json' } }
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : []
  let ingested = 0
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : []
    for (const change of changes) {
      const messages = change.value?.messages
      if (!Array.isArray(messages)) continue // statuses(配信レシート)等は無視
      for (const msg of messages) {
        // v1はテキストのみ。image/audio/document 等は取り込まない。
        if (msg.type !== 'text' || typeof msg.text?.body !== 'string' || !msg.id) continue
        const senderId = typeof msg.from === 'string' ? msg.from : null

        let spaceId: string | null = null
        let identityId: string | null = null
        if (senderId) {
          const identities = await deps.findIdentities(orgId, senderId)
          if (identities.length === 1) {
            spaceId = identities[0].spaceId
            identityId = identities[0].id
          }
        }

        const ts = Number(msg.timestamp)
        const occurredAt = Number.isFinite(ts) && ts > 0
          ? new Date(ts * 1000).toISOString()
          : new Date(0).toISOString()

        await deps.insertMessage({
          orgId,
          spaceId,
          identityId,
          accountId: account.id,
          channel: 'whatsapp',
          direction: 'inbound',
          actor: 'client',
          externalUserId: senderId,
          externalMessageId: msg.id, // wamid はグローバル一意
          contentType: 'text',
          body: msg.text.body,
          payload: { message: msg },
          storagePath: null,
          status: 'received',
          error: null,
          occurredAt,
        })
        ingested += 1
      }
    }
  }

  return { status: 200, body: { ok: true, ingested } }
}
