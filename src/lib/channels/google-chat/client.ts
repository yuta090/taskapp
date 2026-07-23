/**
 * Google Chat app（サービスアカウント / SA）クライアント（PR-c/PR-d 共用の土台）。
 *
 * Pub/Sub 経由で受けたメッセージへの返信・将来の能動発話に使う。SA鍵(env GOOGLE_CHAT_SA_KEY・
 * JSON文字列 `{client_email, private_key, ...}`)で自己署名JWTを作り、OAuth2 token endpoint と
 * 交換する（JWT Bearer flow・`urn:ietf:params:oauth:grant-type:jwt-bearer`）。SA鍵はDBには
 * 一切置かない（env限定・discord ingest の secret と同じ思想）。
 *
 * access token は exp手前までプロセス内メモリにキャッシュする（毎回発行しない）。
 */
import { SignJWT, importPKCS8 } from 'jose'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.bot'
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

let cachedToken: CachedToken | null = null

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

async function exchangeAccessToken(fetchImpl: typeof fetch): Promise<CachedToken> {
  const { clientEmail, privateKey: privateKeyPem } = readServiceAccountKey()
  const privateKey = await importPKCS8(privateKeyPem, 'RS256')

  const nowSec = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: CHAT_SCOPE })
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
 */
export async function getChatAccessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now()) {
    return cachedToken.accessToken
  }
  const token = await exchangeAccessToken(fetchImpl)
  cachedToken = token
  return token.accessToken
}

/** テスト専用: プロセス内メモリの access token キャッシュをリセットする。 */
export function __resetChatAccessTokenCacheForTests(): void {
  cachedToken = null
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
