export const SLACK_CONFIG = {
  clientId: process.env.SLACK_CLIENT_ID || '',
  clientSecret: process.env.SLACK_CLIENT_SECRET || '',
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  stateSecret: process.env.SLACK_STATE_SECRET || '',
}

/**
 * Slack連携が有効かチェック（サーバー/クライアント両方で安全）
 */
export function isSlackConfigured(): boolean {
  return process.env.NEXT_PUBLIC_SLACK_ENABLED === 'true'
}

/**
 * Slack OAuth設定が完全かチェック（サーバーサイドのみ）
 */
export function isSlackFullyConfigured(): boolean {
  return !!(
    SLACK_CONFIG.clientId &&
    SLACK_CONFIG.clientSecret &&
    SLACK_CONFIG.signingSecret
  )
}
