/**
 * Facebook Messenger Platform（Meta Graph）受信Webhookのオーケストレーション。
 *
 * 認証設計（マルチテナント）— WhatsApp と同じ account 単位パス方式:
 *   - Webhookは /api/channels/messenger/webhook/{accountId} で account を特定してから検証する。
 *   - GET(購読検証): Meta が hub.mode=subscribe / hub.verify_token / hub.challenge を送る。
 *     account の verify_token（登録時サーバー生成・オペレーターが App Dashboard に貼付）と
 *     定数時間比較し、一致すれば hub.challenge をそのまま返す（プレーンテキスト）。
 *   - POST(イベント): X-Hub-Signature-256: sha256=<hex(HMAC-SHA256(rawBody, app_secret))>。
 *     account の app_secret で生ボディに対し照合する。未設定/不一致/未知は401・何も書かない。
 *
 * 帰属導出:
 *   - v1は owner_type='org'（自社Page）のみ。platform は org 解決不能なため400で弾く。
 *   - identity 突合は (org, messenger, sender.id=PSID) の active が1件なら space/identity 確定、
 *     0件/複数は null 記録（人力トリアージ）— 他チャネルと一致させる。
 *   - v1はテキストのみ取り込む（delivery/read/postback 等 message.text を持たないイベントは無視）。
 *     dedupeは message.mid（グローバル一意）。timestamp はミリ秒（WhatsAppは秒なので注意）。
 *
 * DM紐付け床（1:1で突合コードを送ると相手先(space)に紐付く。WhatsApp/LINEと同型）:
 *   - 突合コード（channel_link_codes）はチャネル横断。発行済みの1コードがどのチャネルでも通り、
 *     償還したチャネルで identity を作る（findLinkCode/linkIdentity はどちらも optional dep。
 *     未指定なら従来どおりコード償還なしで挙動不変）。
 *   - 内部ユーザーのTA-コード（本人紐付け）はここでは償還しない（v1は本人紐付け未対応）。
 *     本文はマスクして記録し、漏洩失効だけ試みる（グループ誤爆と同じ安全策）。
 *   - 他org（別事務所）の判別に成功したコードは、常に無反応（越境拒否。存在/理由を推測させない
 *     — 「見つからない」場合と区別できる案内を出さない）。コードが見つからない場合のみ、
 *     未突合ユーザー(identity 0件)に案内を1回返す。既存identityがあるユーザーへは
 *     コード形状テキストでも通常メッセージとしてフォールスルーする（帰属を失わない）。
 *
 * Meta の再送を避けるため、署名不一致(401)/platform(400) 以外は常に200を返す。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeLinkCode } from '@/lib/channels/linkCode'
import { looksLikeUserLinkCode, maskUserLinkCode } from '@/lib/channels/userLink'

export interface MessengerAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
}

export interface MessengerInsertInput {
  orgId: string
  spaceId: string | null
  identityId: string | null
  accountId: string
  channel: 'messenger'
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

/** チャネル横断の突合コード（channel_link_codes）。findValidLinkCode の戻り値と同形。 */
export interface MessengerValidLinkCode {
  id: string
  orgId: string
  spaceId: string
  firstUsedAt: string | null
}

export interface MessengerWebhookDeps {
  loadAccount: (accountId: string) => Promise<MessengerAccount | null>
  findIdentities: (
    orgId: string,
    externalId: string,
  ) => Promise<Array<{ id: string; spaceId: string }>>
  insertMessage: (input: MessengerInsertInput) => Promise<{ id: string } | 'duplicate'>
  /** 顧客突合コードの検証（optional・未指定ならコード償還フローを行わず従来どおりの挙動） */
  findLinkCode?: (code: string) => Promise<MessengerValidLinkCode | null>
  /** 突合コードで identity を作成/取得する（linkIdentityViaCode(..., 'messenger') 相当） */
  linkIdentity?: (
    linkCode: MessengerValidLinkCode,
    externalUserId: string,
  ) => Promise<{ id: string; spaceId: string }>
  /** 確認/案内の返信（best-effort。失敗しても webhook 処理は継続する） */
  sendReply?: (account: MessengerAccount, to: string, text: string) => Promise<void>
  /** グループ等に誤って貼られた内部TA-コードの失効（best-effort） */
  expireLeakedUserCode?: (bodyText: string) => Promise<void>
}

/** 突合コード成立時の確認返信 */
export const MESSENGER_LINK_CONFIRMED_TEXT =
  '確認コードを受け付けました。ご登録ありがとうございます。今後のご連絡はこのトークにお送りします。'

/** 有効コードでない場合、未突合ユーザーにのみ返す案内（LINEの LINK_CODE_FAILED_TEXT 相当） */
export const MESSENGER_LINK_FAILED_TEXT =
  '確認コードをお確かめのうえ、もう一度お送りください。ご不明な場合は事務所までご連絡ください。'

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
 * GET /api/channels/messenger/webhook/{accountId} — 購読検証ハンドシェイク。
 * mode=subscribe かつ verify_token 一致で challenge を返す。それ以外は403。
 */
export async function verifyMessengerSubscription(
  accountId: string,
  mode: string | null,
  verifyToken: string | null,
  challenge: string | null,
  deps: MessengerWebhookDeps,
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

interface FbMessage {
  mid?: string
  text?: string
}
interface FbMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: FbMessage
}
interface FbEntry {
  messaging?: FbMessagingEvent[]
}

export async function handleMessengerWebhook(
  accountId: string,
  rawBody: string,
  signatureHeader: string | null,
  deps: MessengerWebhookDeps,
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
    return { status: 400, body: { error: 'platform account not supported for messenger inbound' } }
  }
  const orgId = account.orgId

  // 検証成立後にのみボディを解釈する。以降のパース/内容起因の失敗は200で握る（再送ループ回避）。
  let payload: { entry?: FbEntry[] }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return { status: 200, body: { ok: true, ignored: 'invalid json' } }
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : []
  let ingested = 0
  for (const entry of entries) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : []
    for (const evt of events) {
      // v1はテキストのみ。delivery/read/postback 等 message.text を持たないイベントは無視。
      const msg = evt.message
      if (!msg || typeof msg.text !== 'string' || !msg.mid) continue
      const senderId = typeof evt.sender?.id === 'string' ? evt.sender.id : null
      const body = msg.text
      const messageId = msg.mid

      const ts = Number(evt.timestamp)
      const occurredAt = Number.isFinite(ts) && ts > 0
        ? new Date(ts).toISOString()
        : new Date(0).toISOString()

      const buildInsert = (
        insertSpaceId: string | null,
        insertIdentityId: string | null,
        recordBody: string | null,
      ): MessengerInsertInput => ({
        orgId,
        spaceId: insertSpaceId,
        identityId: insertIdentityId,
        accountId: account.id,
        channel: 'messenger',
        direction: 'inbound',
        actor: 'client',
        externalUserId: senderId,
        externalMessageId: messageId, // message.mid はグローバル一意
        contentType: 'text',
        body: recordBody,
        payload: { message: evt },
        storagePath: null,
        status: 'received',
        error: null,
        occurredAt,
      })

      // コード判定と通常フォールスルーで findIdentities を共有する（二重往復回避）。
      let knownIdentities: Array<{ id: string; spaceId: string }> | undefined

      // (1) 内部ユーザーのTA-コード。v1は本人紐付け未対応（成立させない）。
      // グループ誤爆(LINE)と同じ安全策: 本文はマスクして記録し、漏洩失効だけ試みる。
      if (looksLikeUserLinkCode(body)) {
        await deps.insertMessage(buildInsert(null, null, maskUserLinkCode(body)))
        if (deps.expireLeakedUserCode) {
          try {
            await deps.expireLeakedUserCode(body)
          } catch (error) {
            console.error('Messenger webhook: expireLeakedUserCode failed', error)
          }
        }
        ingested += 1
        continue
      }

      // (2) 顧客突合コード（optional dep。未指定なら従来どおり素通り）
      if (deps.findLinkCode) {
        const code = normalizeLinkCode(body)
        if (code) {
          const linkCode = await deps.findLinkCode(code)
          if (linkCode) {
            if (linkCode.orgId === orgId && senderId && deps.linkIdentity) {
              const identity = await deps.linkIdentity(linkCode, senderId)
              const recorded = await deps.insertMessage(
                buildInsert(identity.spaceId, identity.id, body),
              )
              if (recorded !== 'duplicate' && deps.sendReply) {
                await safeSendReply(deps, account, senderId, MESSENGER_LINK_CONFIRMED_TEXT)
              }
              ingested += 1
              continue
            }
            // 他org（別事務所）のコード: 越境拒否・常に無反応（存在/理由を推測させない）。
            // 成立させず、下の通常メッセージ処理へフォールスルーする。
          } else {
            // コードが見つからない: 未突合ユーザー(identity 0件)にだけ案内を返す。
            // 既存identityがあるユーザーへのコード形状テキストは通常メッセージとして
            // フォールスルーし、帰属を失わない。
            knownIdentities = senderId ? await deps.findIdentities(orgId, senderId) : []
            if (knownIdentities.length === 0) {
              const recorded = await deps.insertMessage(buildInsert(null, null, body))
              if (recorded !== 'duplicate' && senderId && deps.sendReply) {
                await safeSendReply(deps, account, senderId, MESSENGER_LINK_FAILED_TEXT)
              }
              ingested += 1
              continue
            }
            // identities.length > 0 のまま下のフォールスルーへ進む（取得済みを再利用）
          }
        }
      }

      // (3) 通常メッセージ: 既存identityでの帰属（1件なら確定、0件/複数はnull）
      // 上のコード判定で取得済みなら再利用し、findIdentities の二重呼び出しを避ける。
      let spaceId: string | null = null
      let identityId: string | null = null
      if (senderId) {
        const identities = knownIdentities ?? (await deps.findIdentities(orgId, senderId))
        if (identities.length === 1) {
          spaceId = identities[0].spaceId
          identityId = identities[0].id
        }
      }

      await deps.insertMessage(buildInsert(spaceId, identityId, body))
      ingested += 1
    }
  }

  return { status: 200, body: { ok: true, ingested } }
}

/** 返信はbest-effort — 失敗しても webhook 処理（記録・200応答）は継続する */
async function safeSendReply(
  deps: MessengerWebhookDeps,
  account: MessengerAccount,
  to: string,
  text: string,
): Promise<void> {
  try {
    await deps.sendReply!(account, to, text)
  } catch (error) {
    console.error('Messenger webhook: sendReply failed', account.id, error)
  }
}
