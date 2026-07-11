export const NOTION_CONFIG = {
  clientId: process.env.NOTION_CLIENT_ID || '',
  clientSecret: process.env.NOTION_CLIENT_SECRET || '',
}

const NOTION_OAUTH_URL = 'https://api.notion.com/v1/oauth/authorize'

/**
 * Notion OAuth設定が完全かチェック（サーバーサイドのみ）
 */
export function isNotionOAuthConfigured(): boolean {
  return !!(NOTION_CONFIG.clientId && NOTION_CONFIG.clientSecret)
}

export function getNotionRedirectUri(): string {
  return (
    process.env.NOTION_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/notion`
  )
}

/**
 * Notion OAuth認証URLを生成（public integration。owner=userで個人ワークスペース選択を促す）
 */
export function getNotionOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: NOTION_CONFIG.clientId,
    response_type: 'code',
    owner: 'user',
    redirect_uri: getNotionRedirectUri(),
    state,
  })

  return `${NOTION_OAUTH_URL}?${params.toString()}`
}
