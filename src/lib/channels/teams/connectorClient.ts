/**
 * Bot Framework Connector REST の薄いクライアント（fetch直叩き。botbuilder SDK は入れない）。
 *
 * limbo の合言葉償還時に秘書が返信する経路。Teams は Google Chat と異なり HTTP レスポンス自体が
 * 返信にはならない（Bot Framework は非同期チャネル）ため、Connector REST API へ明示的に
 * POST する必要がある。
 *
 * 認証: OAuth2 client_credentials で App トークンを取得し、Bearer ヘッダに載せる。
 * ★トークンはヘッダのみに載せる。URL/クエリには絶対に載せない（Messenger実装での
 *   code-reviewer指摘の教訓＝クエリはログ・プロキシ・Refererに残り漏洩し得る）。
 * ★serviceUrl は必ず呼び出し側（検証済みactivity由来）から引数で受ける。env/グローバルに
 *   焼かない（jwtVerify.ts のSSRF防御と一体：検証を経ていないserviceUrlへは送らない）。
 */

const TOKEN_URL = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token'
const CONNECTOR_SCOPE = 'https://api.botframework.com/.default'

interface CachedAppToken {
  accessToken: string
  expiresAt: number
}

// プロセス内キャッシュ。expires_in を尊重し、期限の30秒前で再取得する（雑な有効期限判定による
// 401連鎖を避ける）。
let cachedToken: CachedAppToken | null = null
const EXPIRY_SAFETY_MARGIN_MS = 30_000

interface TokenResponse {
  access_token?: string
  expires_in?: number
}

/**
 * client_credentials で App トークンを取得する（プロセス内で expiry まで再利用）。
 * 失敗時は例外を投げる（呼び出し側の sendTeamsReply が best-effort に畳む）。
 *
 * fetchImpl はテスト注入用（google-chat/client.ts の getChatAccessToken と同じ規約）。
 */
export async function getAppToken(
  appId: string,
  appPassword: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > now) {
    return cachedToken.accessToken
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: appId,
    client_secret: appPassword,
    scope: CONNECTOR_SCOPE,
  })

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`teams connectorClient: token request failed (${res.status})`)
  }

  const json = (await res.json()) as TokenResponse
  if (!json.access_token) {
    throw new Error('teams connectorClient: token response missing access_token')
  }

  const expiresInMs = (json.expires_in ?? 3600) * 1000
  cachedToken = { accessToken: json.access_token, expiresAt: now + expiresInMs }
  return cachedToken.accessToken
}

/** テストからキャッシュをリセットするための内部エクスポート。 */
export function __resetAppTokenCacheForTest(): void {
  cachedToken = null
}

export interface SendTeamsReplyParams {
  /** 検証済みactivity由来のserviceUrl（jwtVerifyのSSRF防御を経たもの）。 */
  serviceUrl: string
  /** activity.conversation.id（スレッド返信時は ;messageid= を含む値をそのまま渡す）。 */
  conversationId: string
  text: string
}

export interface SendTeamsReplyDeps {
  getToken: () => Promise<string>
  /** テスト注入用。未指定時はグローバル fetch を使う。 */
  fetchImpl?: typeof fetch
}

export type SendTeamsReplyResult = { ok: true } | { ok: false; error: string }

/**
 * Connector REST の POST /v3/conversations/{conversationId}/activities を叩く。
 * best-effort（例外は投げない・reply失敗がlimboの沈黙不変条件を壊さないようにする）。
 */
export async function sendTeamsReply(
  params: SendTeamsReplyParams,
  deps: SendTeamsReplyDeps,
): Promise<SendTeamsReplyResult> {
  try {
    const token = await deps.getToken()
    const base = params.serviceUrl.replace(/\/+$/, '')
    const url = `${base}/v3/conversations/${encodeURIComponent(params.conversationId)}/activities`
    const fetchImpl = deps.fetchImpl ?? fetch

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'message', text: params.text }),
    })
    if (!res.ok) {
      return { ok: false, error: `teams connectorClient: reply failed (${res.status})` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
  }
}
