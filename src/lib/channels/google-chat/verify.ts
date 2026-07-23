/**
 * Google Chat アプリ HTTP 入口の Bearer JWT 検証。
 *
 * Google Chat がスペースへの投稿を Chat app の HTTP エンドポイントへ POST する際、
 * `Authorization: Bearer <jwt>` を付与する（一次情報で確定した仕様）:
 *   - issuer  = chat@system.gserviceaccount.com（Google Chat 専用サービスアカウント）
 *   - audience = 呼び出し先アプリの GCP プロジェクト番号（Chat app 側で設定した値）
 *   - JWKS    = https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com
 *
 * 自前で crypto は書かず jose（createRemoteJWKSet + jwtVerify）に委譲する。
 * JWKS は プロセス内で使い回す（createRemoteJWKSet は内部でキャッシュ・再取得を行う）。
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose'

export const CHAT_APP_ISSUER = 'chat@system.gserviceaccount.com'
export const CHAT_APP_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com'

export type VerifyChatAppRequestResult =
  | { ok: true; spaceHint?: string }
  | { ok: false; reason: 'env_missing' | 'no_token' | 'invalid' }

export interface VerifyChatAppRequestOptions {
  /** 未指定時は env GOOGLE_CHAT_APP_PROJECT_NUMBER を使う */
  projectNumber?: string
  /** テスト注入用。未指定時は createRemoteJWKSet(CHAT_APP_JWKS_URL) を遅延生成して使い回す */
  jwks?: JWTVerifyGetKey
}

let cachedJwks: JWTVerifyGetKey | null = null
function defaultJwks(): JWTVerifyGetKey {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(CHAT_APP_JWKS_URL))
  }
  return cachedJwks
}

const BEARER_RE = /^Bearer\s+(.+)$/i

/**
 * Chat app HTTP リクエストの Authorization ヘッダを検証する。
 * 検証に失敗しても例外は投げず、理由付きの ok:false を返す（呼び出し側=routeが応答コードに変換する）。
 */
export async function verifyChatAppRequest(
  authorizationHeader: string | null,
  opts?: VerifyChatAppRequestOptions,
): Promise<VerifyChatAppRequestResult> {
  const projectNumber = opts?.projectNumber ?? process.env.GOOGLE_CHAT_APP_PROJECT_NUMBER
  if (!projectNumber) return { ok: false, reason: 'env_missing' }

  const match = authorizationHeader ? authorizationHeader.match(BEARER_RE) : null
  if (!match) return { ok: false, reason: 'no_token' }
  const token = match[1]

  const jwks = opts?.jwks ?? defaultJwks()
  try {
    await jwtVerify(token, jwks, {
      issuer: CHAT_APP_ISSUER,
      audience: projectNumber,
    })
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
