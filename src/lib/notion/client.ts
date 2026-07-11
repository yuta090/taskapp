import { NOTION_CONFIG, getNotionRedirectUri } from './config'

const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'

interface NotionTokenResponse {
  access_token: string
  workspace_id: string
  workspace_name: string | null
  workspace_icon: string | null
  bot_id: string
}

export interface NotionTokens {
  accessToken: string
  workspaceId: string
  workspaceName: string | null
  workspaceIcon: string | null
  botId: string
}

/**
 * 認可コードをトークンに交換。Notionトークンは無期限（refresh_tokenなし、
 * token_expires_atはnull）。Basic認証(base64(client_id:client_secret))を使用。
 */
export async function exchangeNotionCode(code: string): Promise<NotionTokens> {
  const credentials = Buffer.from(
    `${NOTION_CONFIG.clientId}:${NOTION_CONFIG.clientSecret}`,
  ).toString('base64')

  const response = await fetch(NOTION_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getNotionRedirectUri(),
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Notion token exchange failed:', response.status, errorBody)
    throw new Error(`Notion token exchange failed (${response.status})`)
  }

  const data: NotionTokenResponse = await response.json()

  return {
    accessToken: data.access_token,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name ?? null,
    workspaceIcon: data.workspace_icon ?? null,
    botId: data.bot_id,
  }
}
