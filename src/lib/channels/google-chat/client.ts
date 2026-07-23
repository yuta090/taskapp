/**
 * Google Chat app（サービスアカウント / SA）クライアント（PR-c/PR-d 共用の土台）。
 *
 * Pub/Sub 経由で受けたメッセージへの返信・将来の能動発話に使う。SA鍵(env GOOGLE_CHAT_SA_KEY・
 * JSON文字列 `{client_email, private_key, ...}`)で自己署名JWTを作り、OAuth2 token endpoint と
 * 交換する（JWT Bearer flow・`urn:ietf:params:oauth:grant-type:jwt-bearer`）。SA鍵はDBには
 * 一切置かない（env限定・discord ingest の secret と同じ思想）。
 *
 * access token は exp手前までプロセス内メモリにキャッシュする（毎回発行しない）。scope単位で
 * キャッシュを分ける（PR-d: 購読管理は chat.bot だけでは足りず追加スコープが要るため）。
 */
import { SignJWT, importPKCS8 } from 'jose'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.bot'
/**
 * Workspace Events API で購読(subscriptions)の作成/更新/削除を行うために要求するスコープ。
 * ⚠ 未確定: chat.bot(app認証)だけで購読operationが通るか、chat.messages.readonly相当の
 * 追加スコープが要るかは Google Workspace Events API のドキュメント依存で本PR時点では
 * 実機未検証。安全側に両方を要求する（不要なら次回接続確認時にCHAT_SCOPEのみへ縮小可）。
 */
const CHAT_EVENTS_SCOPE = [
  'https://www.googleapis.com/auth/chat.bot',
  'https://www.googleapis.com/auth/chat.messages.readonly',
].join(' ')
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
// 自己署名JWT(assertion)自体の有効期限(秒)。Google推奨の上限に合わせる。
const ASSERTION_TTL_SEC = 3600
// access token をキャッシュから捨てる安全マージン(秒)。expires_in ぴったりまで使うと、
// リクエスト処理中に失効する事故があり得るため手前で切り上げる。
const EXPIRY_SAFETY_MARGIN_SEC = 60

interface ServiceAccountKey {
  clientEmail: string
  privateKey: string
}

interface CachedToken {
  accessToken: string
  expiresAtMs: number
}

const tokenCacheByScope = new Map<string, CachedToken>()

function readServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_CHAT_SA_KEY
  if (!raw) throw new Error('GOOGLE_CHAT_SA_KEY is not configured')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('GOOGLE_CHAT_SA_KEY is not valid JSON')
  }
  const key = (parsed ?? {}) as Record<string, unknown>
  const clientEmail = key.client_email
  const privateKey = key.private_key
  if (typeof clientEmail !== 'string' || !clientEmail || typeof privateKey !== 'string' || !privateKey) {
    throw new Error('GOOGLE_CHAT_SA_KEY is missing client_email/private_key')
  }
  return { clientEmail, privateKey }
}

async function exchangeAccessToken(fetchImpl: typeof fetch, scope: string): Promise<CachedToken> {
  const { clientEmail, privateKey: privateKeyPem } = readServiceAccountKey()
  const privateKey = await importPKCS8(privateKeyPem, 'RS256')

  const nowSec = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ASSERTION_TTL_SEC)
    .sign(privateKey)

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Chat token exchange failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  return {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + Math.max(0, data.expires_in - EXPIRY_SAFETY_MARGIN_SEC) * 1000,
  }
}

/**
 * Chat app の access token を返す。exp手前までキャッシュを再利用し、失効間近/未取得のときだけ
 * token endpoint を叩く。env GOOGLE_CHAT_SA_KEY 欠落/不正JSONは例外（fail-closed・呼び元は
 * catch せずそのまま失敗させてよい＝返信できないだけでタスク完了自体は成立させる設計は
 * ingestHandler 側の責務）。
 *
 * scope省略時は CHAT_SCOPE（送信用）。購読管理(PR-d)は CHAT_EVENTS_SCOPE を明示的に渡す。
 * キャッシュは scope 単位で分ける（異なるscopeのtokenを混同しない）。
 */
export async function getChatAccessToken(
  fetchImpl: typeof fetch = fetch,
  scope: string = CHAT_SCOPE,
): Promise<string> {
  const cached = tokenCacheByScope.get(scope)
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.accessToken
  }
  const token = await exchangeAccessToken(fetchImpl, scope)
  tokenCacheByScope.set(scope, token)
  return token.accessToken
}

/** テスト専用: プロセス内メモリの access token キャッシュ(全scope)をリセットする。 */
export function __resetChatAccessTokenCacheForTests(): void {
  tokenCacheByScope.clear()
}

export interface SendChatMessageResult {
  messageName: string | null
}

/**
 * スペースへ発言する。失敗は例外にせず messageName:null を返す（呼び元は reply 失敗より
 * タスク完了の記録を優先する設計・ingestHandler 側の責務）。
 */
export async function sendChatMessage(
  spaceName: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendChatMessageResult> {
  try {
    const accessToken = await getChatAccessToken(fetchImpl)
    const res = await fetchImpl(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('google-chat send: API error', res.status, body.slice(0, 200))
      return { messageName: null }
    }
    const data = (await res.json().catch(() => null)) as { name?: string } | null
    return { messageName: data?.name ?? null }
  } catch (error) {
    console.error('google-chat send: request failed', error)
    return { messageName: null }
  }
}

// =============================================================================
// Workspace Events API 購読管理（PR-d: 購読ライフサイクルの自己修復cron）
//
// 「スペースの全メッセージを受け取る」には Google Workspace Events API の subscription を
// 空間ごとに1つ張る必要がある（張られて初めて Pub/Sub が届く＝PR-c ingest の前提）。
// 本セクションは create/renew/delete の薄いAPIラッパーのみを持つ。生存状態の収束判断・
// リトライは呼び出し側（subscriptionReconciler.ts）の責務。
// =============================================================================

const WORKSPACE_EVENTS_BASE = 'https://workspaceevents.googleapis.com/v1'
const SUBSCRIPTIONS_URL = `${WORKSPACE_EVENTS_BASE}/subscriptions`
const EVENT_TYPE_MESSAGE_CREATED = 'google.workspace.chat.message.v1.created'

/**
 * createChatSubscription が「既存の購読を解決できなかった ALREADY_EXISTS」を検知したときに
 * 投げる。呼び出し側（reconciler）はこれを「破損(broken)」ではなく「次回リトライ」として
 * 扱う（Google側には購読が存在するはずで、一時的なlist失敗などが疑われるため）。
 */
export class ChatSubscriptionAlreadyExistsUnresolvedError extends Error {
  constructor(spaceName: string) {
    super(`Google Chat subscription for ${spaceName} already exists but could not be resolved via list`)
    this.name = 'ChatSubscriptionAlreadyExistsUnresolvedError'
  }
}

function requirePubSubTopic(): string {
  const topic = process.env.GOOGLE_CHAT_PUBSUB_TOPIC
  if (!topic) throw new Error('GOOGLE_CHAT_PUBSUB_TOPIC is not configured')
  return topic
}

function isAlreadyExistsError(status: number, bodyText: string): boolean {
  if (status === 409) return true
  try {
    const parsed = JSON.parse(bodyText) as { error?: { status?: string } }
    return parsed.error?.status === 'ALREADY_EXISTS'
  } catch {
    return false
  }
}

/**
 * 既に存在する購読を target_resource(space名)で逆引きする。ALREADY_EXISTS 回収専用
 * （createのレスポンス自体には既存購読のnameが含まれないため）。見つからない/list失敗はnull。
 */
async function findExistingSubscriptionByTargetResource(
  spaceName: string,
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<{ name: string; expireTime: string | null } | null> {
  const filter = encodeURIComponent(`target_resource="${spaceName}"`)
  const res = await fetchImpl(`${SUBSCRIPTIONS_URL}?filter=${filter}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as {
    subscriptions?: Array<{ name?: string; expireTime?: string }>
  } | null
  const first = data?.subscriptions?.[0]
  if (!first?.name) return null
  return { name: first.name, expireTime: first.expireTime ?? null }
}

/**
 * スペース(spaceName="spaces/XXX")へ全メッセージ購読を作成する。ttl='0s' は Events API上
 * 「更新しない限り最大まで持続」の指定（renewはPATCH updateMask=ttlで明示更新する運用）。
 *
 * ALREADY_EXISTS（同一target_resourceに既存購読がある）は成功として扱い、list APIで
 * 既存購読名を回収して返す（冪等・orphan防止）。回収できなければ
 * ChatSubscriptionAlreadyExistsUnresolvedError を投げる（brokenにはせず次回リトライに回す）。
 *
 * env GOOGLE_CHAT_PUBSUB_TOPIC 未設定は例外（呼び出し側=cronがログしてskipする）。
 */
export async function createChatSubscription(
  spaceName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ name: string; expireTime: string | null }> {
  const topic = requirePubSubTopic()
  const accessToken = await getChatAccessToken(fetchImpl, CHAT_EVENTS_SCOPE)
  const res = await fetchImpl(SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetResource: spaceName,
      eventTypes: [EVENT_TYPE_MESSAGE_CREATED],
      notificationEndpoint: { pubsubTopic: topic },
      payloadOptions: { includeResource: true },
      ttl: '0s',
    }),
  })

  if (res.ok) {
    const data = (await res.json()) as { name: string; expireTime?: string }
    return { name: data.name, expireTime: data.expireTime ?? null }
  }

  const bodyText = await res.text().catch(() => '')
  if (isAlreadyExistsError(res.status, bodyText)) {
    const existing = await findExistingSubscriptionByTargetResource(spaceName, fetchImpl, accessToken)
    if (existing) return existing
    throw new ChatSubscriptionAlreadyExistsUnresolvedError(spaceName)
  }
  throw new Error(`Google Chat subscription create failed (${res.status}): ${bodyText.slice(0, 200)}`)
}

/**
 * 購読を更新（延命）する。PATCH updateMask=ttl で ttl='0s'（最大まで）を指定し直す。
 * 4xx（購読が既に無い等）は例外にする（呼び出し側=reconcilerが broken へ縮退させる）。
 */
export async function renewChatSubscription(
  resourceName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ expireTime: string | null }> {
  const accessToken = await getChatAccessToken(fetchImpl, CHAT_EVENTS_SCOPE)
  const res = await fetchImpl(`${WORKSPACE_EVENTS_BASE}/${resourceName}?updateMask=ttl`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: '0s' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Chat subscription renew failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { expireTime?: string }
  return { expireTime: data.expireTime ?? null }
}

/**
 * 購読を削除する。404（既に無い＝空間削除等で先方が撤去済み）は成功扱い
 * （呼び出し側の markSubscriptionStatus('deleted') を妨げない冪等設計）。
 */
export async function deleteChatSubscription(
  resourceName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const accessToken = await getChatAccessToken(fetchImpl, CHAT_EVENTS_SCOPE)
  const res = await fetchImpl(`${WORKSPACE_EVENTS_BASE}/${resourceName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.ok || res.status === 404) return
  const body = await res.text().catch(() => '')
  throw new Error(`Google Chat subscription delete failed (${res.status}): ${body.slice(0, 200)}`)
}
