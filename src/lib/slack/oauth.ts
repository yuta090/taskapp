import { createHmac, timingSafeEqual } from 'crypto'

export const SLACK_OAUTH_CONFIG = {
  clientId: process.env.SLACK_CLIENT_ID || '',
  clientSecret: process.env.SLACK_CLIENT_SECRET || '',
  stateSecret: process.env.SLACK_STATE_SECRET || '',
}

const SLACK_OAUTH_URL = 'https://slack.com/oauth/v2/authorize'
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access'

/**
 * OAuth state を HMAC 署名付きで生成（CSRF防止）
 */
export function createSignedState(orgId: string, spaceId: string): string {
  const payload = JSON.stringify({ orgId, spaceId, ts: Date.now() })
  const signature = createHmac('sha256', SLACK_OAUTH_CONFIG.stateSecret)
    .update(payload)
    .digest('hex')
  const signedState = JSON.stringify({ payload, signature })
  return Buffer.from(signedState).toString('base64url')
}

/**
 * OAuth state の署名を検証（15分有効期限）
 */
export function verifySignedState(state: string): { orgId: string; spaceId: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
    const { payload, signature } = decoded

    const expectedSignature = createHmac('sha256', SLACK_OAUTH_CONFIG.stateSecret)
      .update(payload)
      .digest('hex')

    const signatureBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null
    }

    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null
    }

    const parsedPayload = JSON.parse(payload)

    // 有効期限チェック（15分）
    const maxAge = 15 * 60 * 1000
    if (Date.now() - parsedPayload.ts > maxAge) {
      console.warn('Slack OAuth state expired')
      return null
    }

    return {
      orgId: parsedPayload.orgId,
      spaceId: parsedPayload.spaceId,
    }
  } catch (e) {
    console.error('Failed to verify Slack OAuth state:', e)
    return null
  }
}

/**
 * Slack OAuth 認証URLを生成
 */
export function getSlackOAuthUrl(orgId: string, spaceId: string): string {
  const state = createSignedState(orgId, spaceId)
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`
  const scopes = ['chat:write', 'channels:read', 'groups:read'].join(',')

  const params = new URLSearchParams({
    client_id: SLACK_OAUTH_CONFIG.clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  })

  return `${SLACK_OAUTH_URL}?${params.toString()}`
}

/**
 * OAuth認可コードをトークンに交換
 */
export async function exchangeCodeForToken(code: string): Promise<{
  ok: boolean
  access_token?: string
  bot_user_id?: string
  team?: { id: string; name: string }
  app_id?: string
  scope?: string
  error?: string
}> {
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`

  const response = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_OAUTH_CONFIG.clientId,
      client_secret: SLACK_OAUTH_CONFIG.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  return response.json()
}
