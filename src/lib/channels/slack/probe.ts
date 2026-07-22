/**
 * Slack Bot Token 検証（登録補助）。
 *
 * 登録時に bot_token で auth.test を叩き、以下を確認する:
 *   - トークン自体の有効性（fetchChatworkAccountId の /me 検証と同役割）。
 *   - 付与スコープ（レスポンスヘッダ x-oauth-scopes）に受信/送信に必要な scope が
 *     含まれるか（fail-closed。不足なら登録させない）。
 * 成功時は auth.test の user_id（Bot自身のuser id）を返す。
 * webhookHandler の bot_user_id ガード（受信の自己ループ除外・自分宛メンション判定）に使う
 * （Chatwork の bot_account_id / Discord の bot_external_id と同役割）。
 */
const AUTH_TEST_ENDPOINT = 'https://slack.com/api/auth.test'

/** chat.postMessage（送信）に必要 */
const REQUIRED_WRITE_SCOPE = 'chat:write'
/** メッセージ読取（受信取り込み）に必要。どちらか一方があればよい（public/privateチャンネル）。 */
const REQUIRED_READ_SCOPES = ['channels:history', 'groups:history']

export type VerifySlackTokenResult =
  | { ok: true; botUserId: string }
  | { ok: false; code: 'slack_token_unverified' | 'slack_missing_scope'; detail?: string }

export async function verifySlackToken(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifySlackTokenResult> {
  let res: Response
  try {
    res = await fetchImpl(AUTH_TEST_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
    })
  } catch {
    return { ok: false, code: 'slack_token_unverified' }
  }
  if (!res.ok) {
    return { ok: false, code: 'slack_token_unverified' }
  }

  const body = (await res.json().catch(() => null)) as { ok?: boolean; user_id?: string } | null
  if (!body || body.ok !== true || typeof body.user_id !== 'string' || body.user_id === '') {
    return { ok: false, code: 'slack_token_unverified' }
  }

  const scopesHeader = res.headers.get('x-oauth-scopes') ?? ''
  const grantedScopes = scopesHeader
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const missing: string[] = []
  if (!grantedScopes.includes(REQUIRED_WRITE_SCOPE)) missing.push(REQUIRED_WRITE_SCOPE)
  if (!REQUIRED_READ_SCOPES.some((scope) => grantedScopes.includes(scope))) {
    missing.push(REQUIRED_READ_SCOPES.join('/'))
  }
  if (missing.length > 0) {
    return { ok: false, code: 'slack_missing_scope', detail: missing.join(', ') }
  }

  return { ok: true, botUserId: body.user_id }
}
