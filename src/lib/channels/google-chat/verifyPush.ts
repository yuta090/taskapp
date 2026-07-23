/**
 * Cloud Pub/Sub push（Workspace Events API 経由の全メッセージ配送・PR-c）の OIDC JWT 検証。
 *
 * Pub/Sub push subscription は `Authorization: Bearer <OIDC JWT>` を付与する。Chat app HTTP
 * 入口（verify.ts・chat@system.gserviceaccount.com 発行）とは別トークン系統のため、検証条件も
 * 別（Fable裁定・4点全一致・fail-closed）:
 *   - issuer   = https://accounts.google.com（accounts.google.com も許容）
 *   - audience = env GOOGLE_CHAT_PUSH_AUDIENCE（push endpoint の URL）
 *   - email    = env GOOGLE_CHAT_PUSH_SA_EMAIL（Pub/Sub push 用 SA の email）
 *   - email_verified === true
 *   - JWKS     = https://www.googleapis.com/oauth2/v3/certs（Google公開鍵）
 *
 * 自前で crypto は書かず jose（createRemoteJWKSet + jwtVerify）に委譲する。
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose'

export const PUSH_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const PUSH_ALLOWED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export type VerifyPushRequestResult =
  | { ok: true }
  | { ok: false; reason: 'env_missing' | 'no_token' | 'invalid' }

export interface VerifyPushRequestOptions {
  /** 未指定時は env GOOGLE_CHAT_PUSH_AUDIENCE を使う */
  audience?: string
  /** 未指定時は env GOOGLE_CHAT_PUSH_SA_EMAIL を使う */
  serviceAccountEmail?: string
  /** テスト注入用。未指定時は createRemoteJWKSet(PUSH_JWKS_URL) を遅延生成して使い回す */
  jwks?: JWTVerifyGetKey
}

let cachedJwks: JWTVerifyGetKey | null = null
function defaultJwks(): JWTVerifyGetKey {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(PUSH_JWKS_URL))
  }
  return cachedJwks
}

const BEARER_RE = /^Bearer\s+(.+)$/i

/**
 * Pub/Sub push リクエストの Authorization ヘッダを検証する。
 * env(audience/serviceAccountEmail) 欠落はサーバー誤設定として env_missing を返す
 * （呼び出し側=routeが500に変換。既知鍵で黙って通さない）。
 */
export async function verifyPushRequest(
  authorizationHeader: string | null,
  opts?: VerifyPushRequestOptions,
): Promise<VerifyPushRequestResult> {
  const audience = opts?.audience ?? process.env.GOOGLE_CHAT_PUSH_AUDIENCE
  const serviceAccountEmail = opts?.serviceAccountEmail ?? process.env.GOOGLE_CHAT_PUSH_SA_EMAIL
  if (!audience || !serviceAccountEmail) return { ok: false, reason: 'env_missing' }

  const match = authorizationHeader ? authorizationHeader.match(BEARER_RE) : null
  if (!match) return { ok: false, reason: 'no_token' }
  const token = match[1]

  const jwks = opts?.jwks ?? defaultJwks()
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: PUSH_ALLOWED_ISSUERS,
      audience,
    })
    if (payload.email !== serviceAccountEmail || payload.email_verified !== true) {
      return { ok: false, reason: 'invalid' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
