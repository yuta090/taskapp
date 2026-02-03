// GitHub App Configuration
import { createHmac, timingSafeEqual } from 'crypto'

export const GITHUB_CONFIG = {
  appId: process.env.GITHUB_APP_ID || '',
  clientId: process.env.GITHUB_APP_CLIENT_ID || '',
  clientSecret: process.env.GITHUB_APP_CLIENT_SECRET || '',
  privateKey: (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  stateSecret: process.env.GITHUB_STATE_SECRET || process.env.GITHUB_WEBHOOK_SECRET || '',

  // URLs
  apiBaseUrl: 'https://api.github.com',
  installUrl: `https://github.com/apps/${process.env.GITHUB_APP_SLUG || 'taskapp'}/installations/new`,

  // Scopes
  requiredPermissions: ['pull_requests:read', 'contents:read', 'metadata:read'],
}

/**
 * GitHub App が設定されているかチェック
 * NEXT_PUBLIC_ 環境変数を使用してサーバー/クライアント両方で同じ結果を返す
 * (Hydration エラー防止のため)
 */
export function isGitHubConfigured(): boolean {
  // NEXT_PUBLIC_ はサーバー/クライアント両方でアクセス可能
  return process.env.NEXT_PUBLIC_GITHUB_ENABLED === 'true'
}

/**
 * GitHub App の設定が完全かチェック（サーバーサイドのみ）
 */
export function isGitHubFullyConfigured(): boolean {
  return !!(
    GITHUB_CONFIG.appId &&
    GITHUB_CONFIG.clientId &&
    GITHUB_CONFIG.clientSecret &&
    GITHUB_CONFIG.privateKey &&
    GITHUB_CONFIG.webhookSecret
  )
}

/**
 * OAuth state を HMAC 署名付きで生成
 * CSRF攻撃を防止するため、署名検証が必須
 */
export function createSignedState(orgId: string, redirectUri: string): string {
  const payload = JSON.stringify({ orgId, redirectUri, ts: Date.now() })
  const signature = createHmac('sha256', GITHUB_CONFIG.stateSecret)
    .update(payload)
    .digest('hex')
  const signedState = JSON.stringify({ payload, signature })
  return Buffer.from(signedState).toString('base64url')
}

/**
 * OAuth state の署名を検証
 * 15分以内の有効期限チェックも行う
 */
export function verifySignedState(state: string): { orgId: string; redirectUri: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
    const { payload, signature } = decoded

    // 署名検証
    const expectedSignature = createHmac('sha256', GITHUB_CONFIG.stateSecret)
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

    // ペイロードをパース
    const parsedPayload = JSON.parse(payload)

    // 有効期限チェック（15分）
    const maxAge = 15 * 60 * 1000
    if (Date.now() - parsedPayload.ts > maxAge) {
      console.warn('OAuth state expired')
      return null
    }

    return {
      orgId: parsedPayload.orgId,
      redirectUri: parsedPayload.redirectUri,
    }
  } catch (e) {
    console.error('Failed to verify state:', e)
    return null
  }
}

export function getGitHubInstallUrl(orgId: string, redirectUri: string): string {
  const state = createSignedState(orgId, redirectUri)
  return `${GITHUB_CONFIG.installUrl}?state=${encodeURIComponent(state)}`
}
