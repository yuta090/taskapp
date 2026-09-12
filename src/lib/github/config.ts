// GitHub App Configuration
import { createHmac, timingSafeEqual } from 'crypto'
import { GITHUB_APP_PERMISSIONS } from './permissions.mjs'

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

  // Scopes（正本は ./permissions.mjs。config.ts と scripts/setup-github-app.mjs の両方がそこから読む）
  requiredPermissions: GITHUB_APP_PERMISSIONS,
}

// 判定だけを使う画面側は './enabled' から直接 import すること（このファイルは crypto を持ち込む）
export { isGitHubConfigured } from './enabled'

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
 *
 * userId（GitHub 側の戻りを受け取るコールバックでログイン中の利用者と照合する ID）を
 * 必ず含める。この ID が無い state はインストール完了時に利用者本人の確認ができないため、
 * 検証側（verifySignedState）で無効として扱う。
 */
export function createSignedState(orgId: string, redirectUri: string, userId: string): string {
  const payload = JSON.stringify({ orgId, redirectUri, sub: userId, ts: Date.now() })
  const signature = createHmac('sha256', GITHUB_CONFIG.stateSecret)
    .update(payload)
    .digest('hex')
  const signedState = JSON.stringify({ payload, signature })
  return Buffer.from(signedState).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * OAuth state の署名を検証
 * 15分以内の有効期限チェックと、利用者 ID（sub）が入っているかのチェックを行う
 */
export function verifySignedState(state: string): { orgId: string; redirectUri: string; userId: string } | null {
  try {
    const base64 = state.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
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

    // 利用者 ID の入っていない state（古い形式）は無効
    if (!parsedPayload.sub || typeof parsedPayload.sub !== 'string') {
      return null
    }

    return {
      orgId: parsedPayload.orgId,
      redirectUri: parsedPayload.redirectUri,
      userId: parsedPayload.sub,
    }
  } catch (e) {
    console.error('Failed to verify state:', e)
    return null
  }
}

export function getGitHubInstallUrl(orgId: string, redirectUri: string, userId: string): string {
  const state = createSignedState(orgId, redirectUri, userId)
  return `${GITHUB_CONFIG.installUrl}?state=${encodeURIComponent(state)}`
}
