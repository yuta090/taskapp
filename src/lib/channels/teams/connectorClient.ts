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

// プロセス内キャッシュ。appId単位（Map）で分ける — v1は共有アプリ1つ前提だが、将来2つ目の
// appが増えても別appのトークンを誤って返さないようにキー化しておく（code-reviewer指摘）。
// expires_in を尊重し、期限の30秒前で再取得する（雑な有効期限判定による401連鎖を避ける）。
const tokenCacheByAppId = new Map<string, CachedAppToken>()
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
  const cached = tokenCacheByAppId.get(appId)
  if (cached && cached.expiresAt - EXPIRY_SAFETY_MARGIN_MS > now) {
    return cached.accessToken
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
  const token: CachedAppToken = { accessToken: json.access_token, expiresAt: now + expiresInMs }
  tokenCacheByAppId.set(appId, token)
  return token.accessToken
}

/** テストからキャッシュをリセットするための内部エクスポート。 */
export function __resetAppTokenCacheForTest(): void {
  tokenCacheByAppId.clear()
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

export interface SendTeamsProactiveParams {
  /**
   * ★呼び出し側（アダプタ）が group.metadata.serviceUrl（過去に検証済みのactivityから保存した
   * 値）由来のものだけを渡す責務を持つ。ここでは検証しない（jwtVerify.tsのSSRF防御はreply系
   * ＝同一リクエスト内のactivity.serviceUrlに対するもので、proactiveは別のリクエストで送る
   * ため対象外。DB保存値なので任意入力ではない）。
   */
  serviceUrl: string
  /** 送信先チャネル（Teamsの external_group_id = channelData.channel.id）。 */
  channelId: string
  text: string
}

export interface SendTeamsProactiveDeps {
  getToken: () => Promise<string>
  /** テスト注入用。未指定時はグローバル fetch を使う。 */
  fetchImpl?: typeof fetch
}

export type SendTeamsProactiveResult =
  | { ok: true; externalMessageId?: string; status?: number }
  | { ok: false; status?: number; error: string }

/**
 * Connector REST の POST /v3/conversations を叩き、チャンネルへ新規会話を作成して同時に
 * 最初のactivityを投稿する（proactive送信。Bot Frameworkでは能動的にメッセージを送るには
 * 既存conversationIdが無いため、reply(sendTeamsReply)とは別APIが要る）。
 *
 * best-effort（例外は投げない・呼び出し側=アダプタが{ok,permanent}へ畳む）。
 */
export async function sendTeamsProactiveToChannel(
  params: SendTeamsProactiveParams,
  deps: SendTeamsProactiveDeps,
): Promise<SendTeamsProactiveResult> {
  try {
    const token = await deps.getToken()
    const base = params.serviceUrl.replace(/\/+$/, '')
    const url = `${base}/v3/conversations`
    const fetchImpl = deps.fetchImpl ?? fetch

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        isGroup: true,
        channelData: { channel: { id: params.channelId } },
        activity: { type: 'message', text: params.text },
      }),
    })
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `teams connectorClient: proactive send failed (${res.status})`,
      }
    }

    // 成功時のボディは ConversationResourceResponse {id, activityId, serviceUrl} が正だが、
    // 万一パースできなくても送信自体は成功として扱う（provider_message_idが載らないだけ）。
    let activityId: string | undefined
    try {
      const json = (await res.json()) as { activityId?: string }
      activityId = typeof json.activityId === 'string' ? json.activityId : undefined
    } catch {
      // ボディ無し/非JSON。実害なし。
    }
    return { ok: true, externalMessageId: activityId, status: res.status }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
  }
}
