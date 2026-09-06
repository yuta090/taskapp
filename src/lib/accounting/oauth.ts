import type { AccountingProviderId } from '@/lib/accounting/types'

/**
 * 会計/請求サービスの OAuth 設定（**server 専用**。client_secret を含む）。
 *
 * 3社とも素の OAuth2 認可コードフローで、違いは「URLと環境変数名とスコープ」だけ。
 * provider ごとに config.ts を書き下ろす（google-calendar / notion 方式）と、
 * トークン交換の失敗の扱いが3通りに分かれて劣化するため、ここに1本化する。
 *
 * 実機で確認済み（2026-07-26）:
 *   - freee     認可 302 / トークン POST 400（＝存在。パラメータ不足での400）
 *   - Misoca    認可 302 / トークン POST 400
 *   - マネーフォワード 認可 302 / トークン POST 400
 *
 * ⚠ スコープ文字列だけは各社の管理画面でアプリを作らないと最終確認ができない。
 *   環境変数で上書きできるようにしてあるので、ズレたらコード変更なしで直せる。
 */

interface AccountingOAuthProvider {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  /** 既定スコープ。環境変数で上書きできる。 */
  scope: string
  /** 認可リクエストに scope を含めるか（freee は指定不要で、送ると弾かれる構成もある）。 */
  sendScope: boolean
}

function env(name: string): string {
  return process.env[name] || ''
}

export const ACCOUNTING_OAUTH: Record<AccountingProviderId, AccountingOAuthProvider> = {
  freee: {
    authorizeUrl: 'https://accounts.secure.freee.co.jp/public_api/authorize',
    tokenUrl: 'https://accounts.secure.freee.co.jp/public_api/token',
    clientId: env('FREEE_CLIENT_ID'),
    clientSecret: env('FREEE_CLIENT_SECRET'),
    scope: env('FREEE_OAUTH_SCOPE'),
    // freee はアプリ登録時に権限を決める方式で、認可URLに scope を載せない。
    sendScope: Boolean(env('FREEE_OAUTH_SCOPE')),
  },
  money_forward: {
    authorizeUrl: 'https://invoice.moneyforward.com/oauth/authorize',
    tokenUrl: 'https://invoice.moneyforward.com/oauth/token',
    clientId: env('MONEY_FORWARD_CLIENT_ID'),
    clientSecret: env('MONEY_FORWARD_CLIENT_SECRET'),
    // クラウド請求書APIv3のスコープは名前空間付き（公式ガイド a04 で確認）。
    // 'write' だけでは通らない。read のみなら mfc/invoice/data.read。
    scope: env('MONEY_FORWARD_OAUTH_SCOPE') || 'mfc/invoice/data.write',
    sendScope: true,
  },
  misoca: {
    authorizeUrl: 'https://app.misoca.jp/oauth2/authorize',
    tokenUrl: 'https://app.misoca.jp/oauth2/token',
    clientId: env('MISOCA_CLIENT_ID'),
    clientSecret: env('MISOCA_CLIENT_SECRET'),
    // Misoca は read / write の2種。書類を作るので write が要る。
    scope: env('MISOCA_OAUTH_SCOPE') || 'write',
    sendScope: true,
  },
}

export function isAccountingOAuthProvider(id: string): id is AccountingProviderId {
  return id in ACCOUNTING_OAUTH
}

/**
 * 接続に必要な設定が揃っているか。揃っていない provider は接続ボタン自体を出さない。
 *
 * 戻り先URLまで見るのは、鍵だけあって戻り先が無い状態でボタンを出すと、押した先で
 * 初めて失敗するため。設定漏れは押す前に分かるほうがよい。
 */
export function isAccountingOAuthConfigured(provider: AccountingProviderId): boolean {
  const cfg = ACCOUNTING_OAUTH[provider]
  if (!cfg.clientId || !cfg.clientSecret) return false
  try {
    return Boolean(getAccountingRedirectUri(provider))
  } catch {
    return false
  }
}

/**
 * 認可後の戻り先。**各社の管理画面に登録した文字列と完全一致**していなければならない
 * （1文字でも違うと認可の時点で弾かれる）。
 *
 * 明示指定（FREEE_REDIRECT_URI 等）を先に見るのは、このプロジェクトの .env に
 * NEXT_PUBLIC_APP_URL が無く、Zoom/Teams も *_REDIRECT_URI を直接置く運用になっているため。
 * どちらも無いときは組み立てずに落とす。`undefined/api/...` という壊れたURLで認可へ飛ばすと、
 * 各社の画面には「リダイレクトURIが一致しません」としか出ず、原因の切り分けに時間を溶かす。
 */
export function getAccountingRedirectUri(provider: AccountingProviderId): string {
  const explicit = process.env[`${provider.toUpperCase()}_REDIRECT_URI`]
  if (explicit) return explicit

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error(
      `${provider}: 戻り先URLが未設定です。${provider.toUpperCase()}_REDIRECT_URI に、` +
        `${provider} の管理画面へ登録したコールバックURLと同じ文字列を設定してください。`,
    )
  }
  return `${appUrl.replace(/\/$/, '')}/api/integrations/callback/${provider}`
}

/** 認可画面へのURL。state は呼び出し側が署名済みのものを渡す（CSRF対策）。 */
export function getAccountingOAuthUrl(provider: AccountingProviderId, state: string): string {
  const cfg = ACCOUNTING_OAUTH[provider]
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: getAccountingRedirectUri(provider),
    state,
  })
  if (cfg.sendScope && cfg.scope) params.set('scope', cfg.scope)
  return `${cfg.authorizeUrl}?${params.toString()}`
}

export interface AccountingTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scopes: string | null
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string | null
  expires_in?: number | null
  scope?: string | null
}

/**
 * 認可コードをトークンに交換する。
 *
 * client_secret は必ずボディで送る（URLに載せるとアクセスログ・リファラに残る）。
 */
export async function exchangeAccountingCode(
  provider: AccountingProviderId,
  code: string,
): Promise<AccountingTokens> {
  const cfg = ACCOUNTING_OAUTH[provider]
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(`${provider}: OAuthの鍵（client_id / client_secret）が設定されていません`)
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: getAccountingRedirectUri(provider),
  })

  const response = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // 応答本文には code が echo される可能性があるため、長さを切って残す
    throw new Error(`${provider}: トークン取得に失敗しました (${response.status}) ${detail.slice(0, 200)}`)
  }

  const data = (await response.json()) as TokenResponse
  if (!data.access_token) {
    throw new Error(`${provider}: トークン応答に access_token がありません`)
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    // expires_in は秒。無い provider は期限なしとして扱い、失効は401で気づく
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scopes: data.scope ?? null,
  }
}

/**
 * リフレッシュトークンでアクセストークンを取り直す。
 * token-manager（src/lib/integrations/token-manager.ts）の RefreshFn として渡す。
 */
export async function refreshAccountingToken(
  provider: AccountingProviderId,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string | null; expiresAt: Date | null }> {
  const cfg = ACCOUNTING_OAUTH[provider]
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  })

  const response = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // 400/401 は失効。それ以外は一時障害として token-manager 側が分類する
    const err = new Error(`${provider}: トークン更新に失敗しました (${response.status}) ${detail.slice(0, 200)}`)
    ;(err as Error & { status?: number }).status = response.status
    throw err
  }

  const data = (await response.json()) as TokenResponse
  if (!data.access_token) {
    throw new Error(`${provider}: 更新応答に access_token がありません`)
  }

  return {
    accessToken: data.access_token,
    // 返らなかった場合に null で上書きすると次回の更新ができなくなる。
    // undefined を返して「変更しない」を意味させる（token-manager の約束）。
    refreshToken: data.refresh_token ?? undefined,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
  }
}
