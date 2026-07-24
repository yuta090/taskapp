/**
 * Microsoft Teams（Bot Framework Connector）messaging endpoint の受信 JWT 検証。
 *
 * Bot Framework は activity を `Authorization: Bearer <jwt>` 付きで POST してくる
 * （一次情報: https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication）:
 *   - issuer  = https://api.botframework.com
 *   - audience = Bot の App ID（env TEAMS_BOT_APP_ID）
 *   - JWKS    = https://login.botframework.com/v1/.well-known/keys
 *
 * ★SSRF防御（設計の要）: 検証済みトークンの `serviceurl` クレームと、リクエストボディの
 *   activity.serviceUrl が一致することを検証する。この突合が無いと、偽の serviceUrl を
 *   仕込まれた activity を受けた際、Connector への返信POST（connectorClient.ts）が
 *   攻撃者の用意したURLへ正当な Bearer トークンごと送られてしまう
 *   （トークンの持ち出し＝攻撃者が Bot Framework の名で外部を叩ける）。
 *   したがって呼び出し側は必ず activity.serviceUrl を第二引数で渡し、ここで
 *   JWTのserviceurlクレームと突合する。不一致は invalid（署名や issuer/audience が
 *   正しくても弾く）。
 *
 * 自前で crypto は書かず jose（createRemoteJWKSet + jwtVerify）に委譲する
 * （google-chat/verify.ts と同じ設計）。JWKS はプロセス内で使い回す。
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose'

export const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com'
export const BOT_FRAMEWORK_JWKS_URL = 'https://login.botframework.com/v1/.well-known/keys'

export type VerifyTeamsActivityResult =
  // serviceUrl は検証済みのJWT serviceurlクレーム値（trim後）。SSRF防御の正本をここに一本化する
  // ため、呼び出し側（route）はConnectorへの送信先にこの値だけを使う（生のactivity.serviceUrlは
  // 使わない）。
  | { ok: true; serviceUrl: string }
  | { ok: false; reason: 'env_missing' | 'no_token' | 'invalid' }

export interface VerifyTeamsActivityOptions {
  /** 未指定時は env TEAMS_BOT_APP_ID を使う */
  appId?: string
  /** テスト注入用。未指定時は createRemoteJWKSet(BOT_FRAMEWORK_JWKS_URL) を遅延生成して使い回す */
  jwks?: JWTVerifyGetKey
}

let cachedJwks: JWTVerifyGetKey | null = null
function defaultJwks(): JWTVerifyGetKey {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(BOT_FRAMEWORK_JWKS_URL))
  }
  return cachedJwks
}

const BEARER_RE = /^Bearer\s+(.+)$/i

/**
 * Bot Framework messaging endpoint への POST の Authorization ヘッダを検証する。
 * 検証に失敗しても例外は投げず、理由付きの ok:false を返す（呼び出し側=routeが応答コードに変換する）。
 *
 * @param activityServiceUrl リクエストボディの activity.serviceUrl（SSRF防御の突合対象）。
 */
export async function verifyTeamsActivityRequest(
  authorizationHeader: string | null,
  activityServiceUrl: string | null | undefined,
  opts?: VerifyTeamsActivityOptions,
): Promise<VerifyTeamsActivityResult> {
  const appId = opts?.appId ?? process.env.TEAMS_BOT_APP_ID
  if (!appId) return { ok: false, reason: 'env_missing' }

  const match = authorizationHeader ? authorizationHeader.match(BEARER_RE) : null
  if (!match) return { ok: false, reason: 'no_token' }
  const token = match[1]

  const jwks = opts?.jwks ?? defaultJwks()
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: BOT_FRAMEWORK_ISSUER,
      audience: appId,
    })

    // SSRF防御: JWTのserviceurlクレームとactivity本文のserviceUrlが厳密一致すること
    // （比較前にtrimのみ行う。大小/末尾スラッシュの正規化はしない=設計どおり）。
    const claimed = typeof payload.serviceurl === 'string' ? payload.serviceurl.trim() : null
    const provided = typeof activityServiceUrl === 'string' ? activityServiceUrl.trim() : null
    if (!claimed || !provided || claimed !== provided) {
      return { ok: false, reason: 'invalid' }
    }

    return { ok: true, serviceUrl: claimed }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
